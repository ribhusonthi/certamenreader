import Player from './Player.js';
import { PERMANENT_ROOMS, ROOM_NAME_MAX_LENGTH } from './constants.js';

import RateLimit from '../RateLimit.js';

import { HEADER, ENDC, OKBLUE, OKGREEN } from '../../bcolors.js';
import { DEFAULT_MIN_YEAR, DEFAULT_MAX_YEAR } from '../../constants.js';
import getRandomTossups from '../../database/certamenreader/get-random-tossups.js';
import getSet from '../../database/certamenreader/get-set.js';
import getSetList from '../../database/certamenreader/get-set-list.js';
import getNumPackets from '../../database/certamenreader/get-num-packets.js';
import { isPrivateSetOwner, privateSetOwner } from '../../database/certamenreader/set-privacy.js';

import { insertTokensIntoHTML } from '../../client/utilities/insert-tokens-into-html.js';
import { sanitizeRounds } from '../../client/utilities/rounds.js';

import checkAnswer from '../../lib/answer-checker.js';

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import isAppropriateString from '../moderation/is-appropriate-string.js';
import censorChat from '../moderation/censor-chat.js';
const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

const rateLimiter = new RateLimit(50, 1000);

const MAX_CHAT_LENGTH = 256;

/**
 * Everything one player has open in a room. Player ids come from the
 * signed-in account, so the same account in two tabs or on two devices is one
 * player; every one of its sockets gets every update, and the player only
 * leaves when the last one closes.
 */
class PlayerSockets {
  constructor () {
    this.open = new Set();
  }

  add (socket) {
    this.open.add(socket);
  }

  /** @returns how many sockets are still open */
  remove (socket) {
    this.open.delete(socket);
    return this.open.size;
  }

  send (message) {
    for (const socket of this.open) {
      if (socket.readyState === 1) socket.send(message);
    }
  }

  get size () {
    return this.open.size;
  }
}

const QuestionProgressEnum = Object.freeze({
  NOT_STARTED: 0,
  READING: 1,
  ANSWER_REVEALED: 2
});

function normalizeSetNames (value) {
  if (Array.isArray(value)) {
    return [
      ...new Set(value.map((name) => String(name || '').trim()).filter(Boolean))
    ];
  }
  const single = String(value || '').trim();
  return single ? [single] : [];
}

/**
 * @returns {Number} The number of points scored on a tossup.
 */
function scoreTossup ({ isCorrect, endOfQuestion, isPace = false }) {
  const negValue = isPace ? 0 : -5;
  return isCorrect ? 10 : endOfQuestion ? 0 : negValue;
}

export default class TossupRoom {
  constructor (
    name,
    isPermanent = false,
    categories = [],
    subcategories = [],
    alternateSubcategories = [],
    difficulties = null,
    setName = undefined
  ) {
    this.name = name;
    this.isPermanent = isPermanent;

    /**
     * @type {Object.<string, Player>}
     */
    this.players = {};
    /** @type {Object.<string, PlayerSockets>} players online, by userId */
    this.sockets = {};
    /**
     * @type {Object.<string, string | null>}
     * userId → username verified from the session cookie at connection time.
     * Used for authorization (private uploaded sets); the display username in
     * this.players is client-controlled and must not be trusted for that.
     */
    this.verifiedUsernames = {};

    this.timeoutID = null;
    // Bumped whenever reading stops for good (a new question, a reveal), so a
    // stray timer from an earlier question can never read on.
    this.readGeneration = 0;
    /**
     * @type {string | null}
     * The userId of the player who buzzed in.
     * We should ensure that buzzedIn is null before calling any readQuestion.
     */
    this.buzzedIn = null;
    this.buzzes = [];
    this.buzzpointIndices = [];
    this.liveAnswer = '';
    this.paused = false;
    this.queryingQuestion = false;
    this.questionNumber = 0;
    this.questionProgress = QuestionProgressEnum.NOT_STARTED;
    this.questionSplit = [];
    this.tossup = {};
    this.wordIndex = 0;

    this.randomQuestionCache = [];
    this.setCache = [];

    this.query = {
      difficulties: difficulties ?? [4, 5],
      minYear: DEFAULT_MIN_YEAR,
      maxYear: DEFAULT_MAX_YEAR,
      packetNumbers: [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
        21, 22, 23, 24
      ],
      setName: setName ?? '',
      setNames: setName ? [setName] : [],
      alternateSubcategories,
      categories,
      subcategories,
      rounds: [],
      reverse: true, // used for `database.getSet`
      standardOnly: false
    };

    this.settings = {
      lock: false,
      public: true,
      rebuzz: false,
      readingSpeed: 50,
      selectBySetName: false,
      skip: false,
      timer: true
    };

    this.rateLimitExceeded = new Set();

    this.timerInterval = null;
    this.timeRemaining = 0;

    this.DEAD_TIME_LIMIT = 20; // time to buzz after question is read
    this.ANSWER_TIME_LIMIT = 20; // time to give answer after buzzing

    getSetList().then(({ setList }) => {
      this.setList = setList;
    });
  }

  /**
   * Runs a websocket handler so that an error in it, thrown or from a rejected
   * promise, is logged instead of stopping the server for every room.
   */
  safely (handler) {
    const failed = (err) => console.error(`room ${this.name}: message handler failed`, err);
    try {
      const result = handler();
      if (result && typeof result.catch === 'function') result.catch(failed);
    } catch (err) {
      failed(err);
    }
  }

  connection (socket, userId, username, verifiedUsername = null) {
    const isNew = !(userId in this.players);
    if (isNew) {
      this.createPlayer(userId);
    }
    this.verifiedUsernames[userId] = verifiedUsername;
    username = this.players[userId].updateUsername(username);
    this.players[userId].isOnline = true;

    console.log(
      `Connection in room ${HEADER}${
        this.name
      }${ENDC} - userId: ${OKBLUE}${userId}${ENDC}, username: ${OKBLUE}${username}${ENDC} - with settings ${OKGREEN}${Object.keys(
        this.settings
      )
        .map((key) => [key, this.settings[key]].join(': '))
        .join('; ')};${ENDC}`
    );
    socket.on('message', (message) => {
      // Over the limit: drop the message. (The check used to stop dropping
      // after the first one, which switched the limit off for that player.)
      if (rateLimiter(socket)) {
        if (!this.rateLimitExceeded.has(username)) {
          console.log(
            `Rate limit exceeded for ${OKBLUE}${username}${ENDC} in room ${HEADER}${this.name}${ENDC}`
          );
          this.rateLimitExceeded.add(username);
        }
        return;
      }

      try {
        message = JSON.parse(message);
      } catch (error) {
        return;
      }
      // Only a JSON object with a type is a message. Anything else (the text
      // "null", a number, a list) used to throw and stop the whole server.
      if (message === null || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
        return;
      }
      this.safely(() => this.message(userId, message));
    });

    socket.on('close', () => {
      this.safely(() => {
        const stillOpen = this.sockets[userId]?.remove(socket) ?? 0;
        if (stillOpen > 0) return; // still in the room in another tab

        if (this.buzzedIn === userId) {
          this.giveAnswer(userId, '');
          this.buzzedIn = null;
        }

        return this.message(userId, {
          type: 'leave',
          userId,
          username
        });
      });
    });

    (this.sockets[userId] ??= new PlayerSockets()).add(socket);

    socket.send(
      JSON.stringify({
        type: 'connection-acknowledged',
        userId,

        isPermanent: this.isPermanent,

        players: this.players,

        canBuzz: this.settings.rebuzz || !this.buzzes.includes(userId),
        buzzedIn: this.buzzedIn,
        questionProgress: this.questionProgress,

        public: this.settings.public,
        readingSpeed: this.settings.readingSpeed,
        rebuzz: this.settings.rebuzz,
        selectBySetName: this.settings.selectBySetName,
        skip: this.settings.skip,
        timer: this.settings.timer
      })
    );

    socket.send(
      JSON.stringify({
        type: 'connection-acknowledged-query',
        ...this.query
      })
    );

    // A question from a private upload is only shown to its owner.
    const hidden = this.tossup?.set?.private === true && this.tossup.set.owner !== verifiedUsername;
    socket.send(
      JSON.stringify({
        type: 'connection-acknowledged-tossup',
        tossup: hidden ? {} : this.tossup
      })
    );
    this.closePrivateSetIfShared();

    if (!hidden && this.questionProgress === QuestionProgressEnum.READING) {
      socket.send(
        JSON.stringify({
          type: 'update-question',
          word: this.questionSplit.slice(0, this.wordIndex).join(' ')
        })
      );
    }

    if (
      !hidden &&
      this.questionProgress === QuestionProgressEnum.ANSWER_REVEALED &&
      this.tossup?.answer
    ) {
      socket.send(
        JSON.stringify({
          type: 'reveal-answer',
          question: insertTokensIntoHTML(
            this.tossup.question,
            this.tossup.question_sanitized,
            [this.buzzpointIndices],
            [' (#) ']
          ),
          answer: this.tossup.answer,
          acceptedAnswers: this.tossup.acceptedAnswers,
          matchedAnswerIndex: this.tossup.matchedAnswerIndex
        })
      );
    }

    this.sendSocketMessage({
      type: 'join',
      isNew,
      userId,
      username,
      user: this.players[userId]
    });
  }

  async message (userId, message) {
    const type = message.type || '';
    let allowedPacketNumbers;

    switch (type) {
      case 'buzz':
        this.buzz(userId);
        break;

      case 'change-username': {
        if (typeof message.username !== 'string') {
          break;
        }

        if (!isAppropriateString(message.username)) {
          this.sendPrivateMessage(userId, {
            type: 'force-username',
            username: this.players[userId].username,
            message:
              'Your username contains an inappropriate word, so it has been reverted.'
          });
          break;
        }

        const oldUsername = this.players[userId].username;
        const newUsername = this.players[userId].updateUsername(
          message.username
        );

        this.sendSocketMessage({
          type: 'change-username',
          userId,
          oldUsername,
          newUsername
        });
        break;
      }

      // Chat is open in every room. Banned words are starred out before the
      // message goes to anyone, including while it is being typed.
      case 'chat':
      case 'chat-live-update':
        if (typeof message.message !== 'string') {
          return;
        }

        this.sendSocketMessage({
          type,
          username: this.players[userId].username,
          message: censorChat(message.message.slice(0, MAX_CHAT_LENGTH)),
          userId
        });
        break;

      case 'clear-stats':
        this.players[userId].clearStats();
        this.sendSocketMessage({
          type: 'clear-stats',
          userId
        });
        break;

      case 'difficulties':
        if (
          message.value.some(
            (value) =>
              typeof value !== 'number' ||
              isNaN(value) ||
              value < 0 ||
              value > 10
          )
        ) {
          return;
        }

        this.sendSocketMessage({
          type: 'difficulties',
          username: this.players[userId].username,
          value: message.value
        });
        this.adjustQuery(['difficulties'], [message.value]);
        break;

      case 'give-answer':
        if (
          userId !== this.buzzedIn ||
          typeof message.givenAnswer !== 'string'
        ) {
          return;
        }

        this.giveAnswer(userId, message.givenAnswer);
        break;

      case 'give-answer-live-update':
        if (userId !== this.buzzedIn || typeof message.message !== 'string') {
          return;
        }

        this.liveAnswer = message.message;
        this.sendSocketMessage({
          type: 'give-answer-live-update',
          username: this.players[userId].username,
          message: message.message
        });
        break;

      case 'leave':
        // Sent by the socket close handler once a player's last socket closes;
        // a 'leave' sent by a client that is still connected is ignored.
        if (this.sockets[userId]?.size) {
          return;
        }
        // this.deletePlayer(userId);  dont remove this comment
        this.players[userId].isOnline = false;
        delete this.sockets[userId];
        this.sendSocketMessage(message);
        break;

      case 'next':
      case 'skip':
      case 'start':
        this.next(userId, type);
        break;

      case 'packet-number':
        if (!this.query.setName) return;
        allowedPacketNumbers = await getNumPackets(this.query.setName);
        if (
          message.value.some(
            (value) =>
              typeof value !== 'number' ||
              value < 1 ||
              value > allowedPacketNumbers
          )
        ) { return; }

        this.adjustQuery(['packetNumbers'], [message.value]);
        this.sendSocketMessage({
          type: 'packet-number',
          username: this.players[userId].username,
          value: this.query.packetNumbers
        });
        break;

      case 'pause':
        this.pause(userId, message.pausedTime);
        break;

      case 'reading-speed':
        if (isNaN(message.value) || message.value > 100 || message.value < 0) {
          return;
        }

        this.settings.readingSpeed = message.value;
        this.sendSocketMessage({
          type: 'reading-speed',
          username: this.players[userId].username,
          value: this.settings.readingSpeed
        });
        break;

      case 'set-name': {
        if (typeof message.value !== 'string') {
          return;
        }
        message.setNames = normalizeSetNames(message.setNames || message.value);
        // Allow empty selection to clear set names (switches to random mode).
        // Names outside the public set list are only allowed when this player
        // is the verified owner of that private uploaded set.
        for (const name of message.setNames) {
          if (this.setList?.includes(name)) continue;
          if (!(await isPrivateSetOwner(name, this.verifiedUsernames[userId]))) {
            return;
          }
          // A private upload is only shown to its owner, so it can't be played while anyone else is here.
          if (!this.onlyUserOnline(this.verifiedUsernames[userId])) {
            return;
          }
        }

        message.value = message.setNames.length === 1 ? message.setNames[0] : '';
        message.packetNumbers = message.value ? (message.packetNumbers || []) : [];
        allowedPacketNumbers = message.value ? await getNumPackets(message.value) : 0;
        if (
          message.packetNumbers.some(
            (num) => num > allowedPacketNumbers || num < 1
          )
        ) { return; }

        this.sendSocketMessage({
          type: 'set-name',
          username: this.players[userId].username,
          value: message.value,
          setNames: message.setNames
        });
        this.adjustQuery(
          ['setName', 'setNames', 'packetNumbers'],
          [message.value, message.setNames, message.packetNumbers]
        );
        break;
      }

      case 'toggle-lock':
        if (this.settings.public) {
          return;
        }

        this.settings.lock = message.lock;
        this.sendSocketMessage({
          type: 'toggle-lock',
          lock: this.settings.lock,
          username: this.players[userId].username
        });
        break;

      case 'toggle-rebuzz':
        this.settings.rebuzz = message.rebuzz;
        this.sendSocketMessage({
          type: 'toggle-rebuzz',
          rebuzz: this.settings.rebuzz,
          username: this.players[userId].username
        });
        break;

      case 'toggle-skip':
        this.settings.skip = message.skip;
        this.sendSocketMessage({
          type: 'toggle-skip',
          skip: this.settings.skip,
          username: this.players[userId].username
        });
        break;

      case 'toggle-standard-only':
        this.query.standardOnly = message.standardOnly;
        this.sendSocketMessage({
          type: 'toggle-standard-only',
          standardOnly: message.standardOnly,
          username: this.players[userId].username
        });
        this.adjustQuery(['standardOnly'], [message.standardOnly]);
        break;

      case 'toggle-timer':
        if (this.settings.public) {
          return;
        }

        this.settings.timer = message.timer;
        this.sendSocketMessage({
          type: 'toggle-timer',
          timer: this.settings.timer,
          username: this.players[userId].username
        });
        break;

      case 'toggle-visibility':
        if (this.isPermanent) {
          break;
        }

        this.settings.public = message.public;
        this.settings.timer = true;
        this.sendSocketMessage({
          type: 'toggle-visibility',
          public: this.settings.public,
          username: this.players[userId].username
        });
        break;

      case 'update-categories':
        if (this.isPermanent) {
          break;
        }
        // this.sendSocketMessage({
        //   type: 'update-categories',
        //   categories: message.categories,
        //   subcategories: message.subcategories,
        //   alternateSubcategories: message.alternateSubcategories,
        //   username: this.players[userId].username,
        // });

        // if (
        //   [
        //     message.categories,
        //     message.subcategories,
        //     message.alternateSubcategories,
        //   ].some((array) => !Array.isArray(array))
        // ) {
        //   break;
        // }

        // message.categories = message.categories.filter((category) =>
        //   CATEGORIES.includes(category)
        // );
        // message.subcategories = message.subcategories.filter((subcategory) =>
        //   SUBCATEGORIES_FLATTENED.includes(subcategory)
        // );
        // message.alternateSubcategories = message.alternateSubcategories.filter(
        //   (subcategory) =>
        //     ALTERNATE_SUBCATEGORIES_FLATTENED.includes(subcategory)
        // );

        // if (
        //   message.subcategories.some((sub) => {
        //     const parent = SUBCATEGORY_TO_CATEGORY[sub];
        //     return !message.categories.includes(parent);
        //   }) ||
        //   message.alternateSubcategories.some((sub) => {
        //     const parent = ALTERNATE_SUBCATEGORY_TO_CATEGORY[sub];
        //     return !message.categories.includes(parent);
        //   })
        // ) {
        //   break;
        // }

        // Rounds feed a $regex, so only known round names get through.
        message.rounds = sanitizeRounds(message.rounds);

        this.sendSocketMessage({
          type: 'update-categories',
          categories: message.categories,
          subcategories: message.subcategories,
          alternateSubcategories: message.alternateSubcategories,
          rounds: message.rounds,
          username: this.players[userId].username
        });
        this.adjustQuery(
          ['categories', 'subcategories', 'alternateSubcategories', 'rounds'],
          [
            message.categories,
            message.subcategories,
            message.alternateSubcategories,
            message.rounds
          ]
        );
        break;

      case 'year-range': {
        const minYear = isNaN(message.minYear)
          ? DEFAULT_MIN_YEAR
          : parseInt(message.minYear);
        const maxYear = isNaN(message.maxYear)
          ? DEFAULT_MAX_YEAR
          : parseInt(message.maxYear);

        if (maxYear < minYear) {
          return this.sendPrivateMessage(userId, {
            type: 'year-range',
            minYear: this.query.minYear,
            maxYear: this.query.maxYear
          });
        }

        this.sendSocketMessage({
          type: 'year-range',
          minYear,
          maxYear
        });
        this.adjustQuery(['minYear', 'maxYear'], [minYear, maxYear]);
        break;
      }
    }
  }

  adjustQuery (settings, values) {
    if (settings.length !== values.length) {
      return;
    }

    for (let i = 0; i < settings.length; i++) {
      const setting = settings[i];
      const value = values[i];
      if (Object.prototype.hasOwnProperty.call(this.query, setting)) {
        this.query[setting] = value;
      }
    }

    if (this.query.setName && this.query.setName.length > 0) {
      this.questionNumber = 0;
      getSet(this.query).then((set) => {
        this.setCache = set;
      });
    } else {
      console.log('Query: ', this.query);
      getRandomTossups({ ...this.query, number: 20 }).then((tossups) => {
        this.randomQuestionCache = tossups;
      });
    }
  }

  async advanceQuestion () {
    this.queryingQuestion = true;
    await this.closePrivateSetIfShared();

    if (this.query.setName && this.query.setName.length > 0) {
      if (this.setCache.length === 0) {
        this.sendSocketMessage({
          type: 'end-of-set'
        });
        return false;
      } else {
        this.tossup = this.setCache.pop();
        this.questionNumber = this.tossup.number;
        this.query.packetNumbers = this.query.packetNumbers.filter(
          (packetNumber) => packetNumber >= this.tossup.packet.number
        );
      }
    } else {
      if (this.randomQuestionCache.length === 0) {
        console.log('Query: ', this.query);
        this.randomQuestionCache = await getRandomTossups({ ...this.query, number: 20 });
        if (this.randomQuestionCache.length === 0) {
          this.tossup = {};
          this.sendSocketMessage({
            type: 'no-questions-found'
          });
          return false;
        }
      }

      this.tossup = this.randomQuestionCache.pop();
    }

    this.questionSplit = this.tossup.question_sanitized
      .split(' ')
      .filter((word) => word !== '');
    return true;
  }

  buzz (userId) {
    // Only while a question is being read. A buzz before Start (or after the
    // answer was shown) used to leave buzzedIn set with nothing to answer,
    // which locked the room: Start, Next and Skip were all ignored after it.
    if (this.questionProgress !== QuestionProgressEnum.READING || Object.keys(this.tossup).length === 0) return;
    if (!this.settings.rebuzz && this.buzzes.includes(userId)) return;

    if (this.buzzedIn) {
      return this.sendSocketMessage({
        type: 'lost-buzzer-race',
        userId,
        username: this.players[userId].username
      });
    }

    clearTimeout(this.timeoutID);
    this.buzzedIn = userId;
    this.buzzes.push(userId);
    this.buzzpointIndices.push(
      this.questionSplit.slice(0, this.wordIndex).join(' ').length
    );
    this.paused = false;

    this.sendSocketMessage({
      type: 'buzz',
      userId,
      username: this.players[userId].username
    });

    this.sendSocketMessage({
      type: 'update-question',
      word: '(#)'
    });

    this.startServerTimer(this.ANSWER_TIME_LIMIT * 10, () => {
      this.giveAnswer(userId, this.liveAnswer);
    });
  }

  createPlayer (userId) {
    this.players[userId] = new Player(userId);
  }

  deletePlayer (userId) {
    this.sendSocketMessage({
      type: 'leave',
      userId,
      username: this.players[userId].username
    });

    delete this.players[userId];
  }

  giveAnswer (userId, givenAnswer) {
    if (this.buzzedIn !== userId) return;

    this.liveAnswer = '';
    clearInterval(this.timerInterval);
    this.sendSocketMessage({
      type: 'timer-update',
      timeRemaining: this.ANSWER_TIME_LIMIT * 10
    });

    if (Object.keys(this.tossup).length === 0) {
      this.buzzedIn = null; // nothing to answer; never leave the room locked
      return;
    }

    const celerity =
      this.questionSplit.slice(this.wordIndex).join(' ').length /
      this.tossup.question.length;
    const endOfQuestion = this.wordIndex === this.questionSplit.length;
    // Whitespace-only answers must never be matched against the answerline —
    // the matcher treats an empty token list as a vacuous match and would
    // otherwise accept " " as correct.
    const hasContent = typeof givenAnswer === 'string' && givenAnswer.trim() !== '';
    const { directive, directedPrompt, matchedIndex } = hasContent
      ? checkAnswer(this.tossup.answer, givenAnswer, {
        category: this.tossup.category,
        acceptedAnswers: this.tossup.acceptedAnswers,
        promptAnswers: this.tossup.promptAnswers,
        rejectAnswers: this.tossup.rejectAnswers
      })
      : { directive: 'reject', directedPrompt: undefined };
    // Which listed answer was matched, so the reveal can show the others.
    if (directive === 'accept') this.tossup.matchedAnswerIndex = matchedIndex;
    const points = scoreTossup({
      isCorrect: directive === 'accept',
      endOfQuestion
    });

    switch (directive) {
      case 'accept':
        this.buzzedIn = null;
        this.revealQuestion();
        this.players[userId].updateStats(points, celerity);
        Object.values(this.players).forEach((player) => {
          player.tuh++;
        });
        break;
      case 'reject':
        this.buzzedIn = null;
        this.players[userId].updateStats(points, celerity);
        if (
          !this.settings.rebuzz &&
          this.buzzes.length === Object.keys(this.sockets).length
        ) {
          this.revealQuestion();
          Object.values(this.players).forEach((player) => {
            player.tuh++;
          });
        } else {
          this.readQuestion(Date.now());
        }
        break;
      case 'prompt':
        this.startServerTimer(this.ANSWER_TIME_LIMIT * 10, () => {
          this.giveAnswer(userId, this.liveAnswer);
        });
    }

    this.sendSocketMessage({
      type: 'give-answer',
      userId,
      username: this.players[userId].username,
      givenAnswer,
      directive,
      directedPrompt,
      score: points,
      celerity: this.players[userId].celerity.correct.average,
      // the below fields are used to record buzzpoint data
      tossup: this.tossup,
      perQuestionCelerity: celerity,
      buzzpointIndex: this.buzzpointIndices[this.buzzpointIndices.length - 1]
    });
  }

  /**
   * Logic for when the user presses the next button.
   * @param {string} userId - The userId of the user who pressed the next button.
   * @param {'next' | 'skip' | 'start'} type - The type of next button pressed.
   * @returns
   */
  async next (userId, type) {
    if (this.queryingQuestion) return;
    if (this.buzzedIn) return; // prevents skipping when someone has buzzed in

    if (
      this.questionProgress === QuestionProgressEnum.READING &&
      !this.settings.skip
    ) { return; }

    // Stop everything still running for the old question: its reading loop
    // and its countdown. A countdown left running would fire partway through
    // the next question and reveal it while words were still arriving.
    clearTimeout(this.timeoutID);
    clearInterval(this.timerInterval);
    this.timerInterval = null;
    this.readGeneration++;

    this.buzzedIn = null;
    this.buzzes = [];
    this.buzzpointIndices = [];
    this.paused = false;

    if (this.questionProgress !== QuestionProgressEnum.ANSWER_REVEALED) {
      this.revealQuestion();
    }

    const hasNextQuestion = await this.advanceQuestion();
    this.queryingQuestion = false;
    if (!hasNextQuestion) return;

    this.sendSocketMessage({
      type,
      userId,
      username: this.players[userId].username,
      tossup: this.tossup
    });

    this.wordIndex = 0;
    this.questionProgress = QuestionProgressEnum.READING;
    this.readQuestion(Date.now());
  }

  pause (userId) {
    if (this.buzzedIn) return;
    // Only a question being read can be paused; resuming anything else would
    // start reading a revealed (or no) question again.
    if (this.questionProgress !== QuestionProgressEnum.READING) return;

    this.paused = !this.paused;

    if (this.paused) {
      clearTimeout(this.timeoutID);
      clearInterval(this.timerInterval);
    } else if (this.wordIndex >= this.questionSplit.length) {
      this.startServerTimer(this.timeRemaining, this.revealQuestion.bind(this));
    } else {
      this.readQuestion(Date.now());
    }

    this.sendSocketMessage({
      type: 'pause',
      paused: this.paused,
      username: this.players[userId].username
    });
  }

  async readQuestion (expectedReadTime) {
    if (Object.keys(this.tossup).length === 0) return;
    if (this.wordIndex >= this.questionSplit.length) {
      this.startServerTimer(
        this.DEAD_TIME_LIMIT * 10,
        this.revealQuestion.bind(this)
      );
      return;
    }

    const word = this.questionSplit[this.wordIndex];
    this.wordIndex++;

    this.sendSocketMessage({
      type: 'update-question',
      word
    });

    // calculate time needed before reading next word
    let time = Math.log(word.length) + 1;
    if (
      (word.endsWith('.') &&
        word.charCodeAt(word.length - 2) > 96 &&
        word.charCodeAt(word.length - 2) < 123) ||
      word.slice(-2) === '.\u201d' ||
      word.slice(-2) === '!\u201d' ||
      word.slice(-2) === '?\u201d'
    ) {
      time += 2;
    } else if (word.endsWith(',') || word.slice(-2) === ',\u201d') {
      time += 0.75;
    }

    time = time * 0.9 * (125 - this.settings.readingSpeed);
    const delay = time - Date.now() + expectedReadTime;

    const generation = this.readGeneration;
    clearTimeout(this.timeoutID); // one reading loop at a time
    this.timeoutID = setTimeout(() => {
      if (generation !== this.readGeneration) return;
      this.readQuestion(time + expectedReadTime);
    }, delay);
  }

  revealQuestion () {
    if (Object.keys(this.tossup).length === 0) return;

    clearTimeout(this.timeoutID);
    this.readGeneration++;

    this.questionProgress = QuestionProgressEnum.ANSWER_REVEALED;
    this.sendSocketMessage({
      type: 'reveal-answer',
      question: insertTokensIntoHTML(
        this.tossup.question,
        this.tossup.question_sanitized,
        [this.buzzpointIndices],
        [' (#) ']
      ),
      answer: this.tossup.answer,
      acceptedAnswers: this.tossup.acceptedAnswers,
      matchedAnswerIndex: this.tossup.matchedAnswerIndex
    });
  }

  sendSocketMessage (message) {
    // Text and answers of a question from a private upload go only to its owner.
    const ownerOnly = this.tossup?.set?.private === true &&
      ['word', 'question', 'answer', 'tossup', 'acceptedAnswers'].some(key => key in message);
    const owner = this.tossup?.set?.owner;
    message = JSON.stringify(message);
    for (const [userId, socket] of Object.entries(this.sockets)) {
      if (ownerOnly && this.verifiedUsernames[userId] !== owner) continue;
      socket.send(message);
    }
  }

  // Whether every player connected to the room is signed in as this user.
  onlyUserOnline (username) {
    return Boolean(username) && Object.keys(this.sockets).every(id => this.verifiedUsernames[id] === username);
  }

  // Private uploads are only shown to their owner: when anyone else is in the
  // room, go back to all sets.
  async closePrivateSetIfShared () {
    const names = this.query.setNames?.length ? this.query.setNames : [this.query.setName].filter(Boolean);
    for (const name of names) {
      if (this.setList?.includes(name)) continue;
      const owner = await privateSetOwner(name);
      if (owner && !this.onlyUserOnline(owner)) {
        this.adjustQuery(['setName', 'setNames', 'packetNumbers'], ['', [], []]);
        this.sendSocketMessage({ type: 'set-name', username: 'Room', value: '', setNames: [] });
        return true;
      }
    }
    return false;
  }

  sendPrivateMessage (userId, message) {
    message = JSON.stringify(message);
    this.sockets[userId]?.send(message);
  }

  /**
   *
   * @param {number} time
   * @param {Function} callback - called when timer is up
   * @returns
   */
  startServerTimer (time, callback) {
    if (this.settings.timer === false) {
      return;
    }

    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    this.timeRemaining = time;

    this.timerInterval = setInterval(() => {
      if (this.timeRemaining <= 0) {
        clearInterval(this.timerInterval);
        callback();
      }

      this.sendSocketMessage({
        type: 'timer-update',
        timeRemaining: this.timeRemaining
      });
      this.timeRemaining--;
    }, 100);
  }
}

const tossupRooms = {};

for (const room of PERMANENT_ROOMS) {
  const { name, categories, subcategories, alternateSubcategories, difficulties, setName } = room;
  tossupRooms[name] = new TossupRoom(
    name,
    true,
    categories,
    subcategories,
    alternateSubcategories,
    difficulties,
    setName
  );
}

/**
 * Returns the room with the given room name.
 * If the room does not exist, it is created.
 * @param {String} roomName
 * @returns {TossupRoom}
 */
function createAndReturnRoom (roomName, isPrivate = false) {
  roomName = DOMPurify.sanitize(roomName);
  roomName = roomName?.substring(0, ROOM_NAME_MAX_LENGTH) ?? '';

  if (!Object.prototype.hasOwnProperty.call(tossupRooms, roomName)) {
    const newRoom = new TossupRoom(roomName, false);
    newRoom.settings.public = !isPrivate;
    tossupRooms[roomName] = newRoom;
  }

  return tossupRooms[roomName];
}

export { createAndReturnRoom, tossupRooms };
