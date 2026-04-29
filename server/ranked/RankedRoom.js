import TossupRoom from '../multiplayer/TossupRoom.js';
import getRandomTossups from '../../database/certamenreader/get-random-tossups.js';
import { recordRankedResult } from '../../database/account-info/ranked.js';
import {
  getRankedMode,
  RANKED_BASE_ANSWER_SECONDS,
  RANKED_QUESTION_COUNT,
  RANKED_TYPING_ANSWER_SECONDS
} from './constants.js';

function shuffle (array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

class RankedRoom extends TossupRoom {
  constructor ({ roomName, mode, players }) {
    const rankedMode = getRankedMode(mode);
    super(roomName, false, rankedMode.categories);

    this.ranked = true;
    this.rankedMode = rankedMode;
    this.rankedPlayers = players;
    this.authorizedUsernames = new Set(players.map(player => player.username));
    this.rankedQuestionIndex = 0;
    this.rankedQuestions = null;
    this.matchComplete = false;
    this.result = null;
    this.answerTimerExtended = false;
    this.rankedBuzzStartedAt = null;

    this.query.setName = '';
    this.query.categories = rankedMode.categories;
    this.query.difficulties = [4, 5, 6, 7, 8, 9, 10];
    this.settings.public = false;
    this.settings.lock = true;
    this.settings.rebuzz = false;
    this.settings.skip = false;
    this.settings.timer = true;
    this.ANSWER_TIME_LIMIT = RANKED_BASE_ANSWER_SECONDS;
  }

  connection (socket, userId, username) {
    if (!this.authorizedUsernames.has(username)) {
      socket.send(JSON.stringify({
        type: 'error',
        error: 'This ranked room is reserved for the matched players.'
      }));
      socket.close(3000);
      return;
    }

    super.connection(socket, userId, username);
    this.sendRankedState(userId);
  }

  async message (userId, message) {
    const allowedTypes = new Set([
      'buzz',
      'give-answer',
      'give-answer-live-update',
      'leave',
      'next',
      'pause',
      'ping',
      'start'
    ]);

    if (!allowedTypes.has(message.type)) {
      return;
    }

    if ((message.type === 'start' || message.type === 'next') && Object.keys(this.sockets).length < 2) {
      this.sendPrivateMessage(userId, {
        type: 'ranked-waiting',
        message: 'Waiting for both ranked players to connect.'
      });
      return;
    }

    if (this.matchComplete && (message.type === 'start' || message.type === 'next' || message.type === 'buzz')) {
      return;
    }

    const hadAnswerText = this.liveAnswer.trim().length > 0;
    const result = await super.message(userId, message);

    if (
      message.type === 'give-answer-live-update' &&
      userId === this.buzzedIn &&
      !this.answerTimerExtended &&
      !hadAnswerText &&
      typeof message.message === 'string' &&
      message.message.trim().length > 0
    ) {
      this.extendAnswerTimerForTyping(userId);
    }

    return result;
  }

  buzz (userId) {
    const canBuzz = (this.settings.rebuzz || !this.buzzes.includes(userId)) && !this.buzzedIn;
    super.buzz(userId);

    if (canBuzz && this.buzzedIn === userId) {
      this.answerTimerExtended = false;
      this.rankedBuzzStartedAt = Date.now();
    }
  }

  extendAnswerTimerForTyping (userId) {
    const elapsedTenths = this.rankedBuzzStartedAt
      ? Math.floor((Date.now() - this.rankedBuzzStartedAt) / 100)
      : 0;
    const targetRemaining = (RANKED_TYPING_ANSWER_SECONDS * 10) - elapsedTenths;
    const extendedTime = Math.max(this.timeRemaining, targetRemaining);

    if (extendedTime <= this.timeRemaining) return;

    this.answerTimerExtended = true;
    this.startServerTimer(extendedTime, () => {
      this.giveAnswer(userId, this.liveAnswer);
    });
  }

  async loadRankedQuestions () {
    if (this.rankedQuestions) return;

    const usedIds = new Set();
    const questions = [];

    for (const category of shuffle(this.rankedMode.distribution)) {
      let selected = null;
      const candidates = await getRandomTossups({
        ...this.query,
        categories: [category],
        number: 5,
        setName: ''
      });

      for (const tossup of candidates) {
        if (!usedIds.has(String(tossup._id))) {
          selected = tossup;
          break;
        }
      }

      if (!selected) {
        const fallback = await getRandomTossups({
          ...this.query,
          categories: [category],
          number: 1,
          setName: ''
        });
        selected = fallback[0];
      }

      if (!selected) {
        this.rankedQuestions = [];
        return;
      }

      usedIds.add(String(selected._id));
      questions.push(selected);
    }

    this.rankedQuestions = questions;
  }

  async advanceQuestion () {
    this.queryingQuestion = true;
    await this.loadRankedQuestions();

    if (!this.rankedQuestions || this.rankedQuestions.length === 0) {
      this.tossup = {};
      this.sendSocketMessage({ type: 'no-questions-found' });
      return false;
    }

    this.tossup = this.rankedQuestions.shift();
    this.rankedQuestionIndex++;
    this.questionSplit = this.tossup.question_sanitized
      .split(' ')
      .filter((word) => word !== '');
    return true;
  }

  revealQuestion () {
    const wasComplete = this.matchComplete;
    super.revealQuestion();

    if (!wasComplete && this.rankedQuestionIndex >= RANKED_QUESTION_COUNT) {
      this.finalizeMatch().catch(err => {
        console.log('[RANKED] Failed to finalize match', err);
      });
    }
  }

  async finalizeMatch () {
    if (this.matchComplete) return;
    this.matchComplete = true;
    clearTimeout(this.timeoutID);
    clearInterval(this.timerInterval);

    const scores = {};
    for (const player of this.rankedPlayers) {
      const userId = `ranked:${player.username}`;
      scores[player.username] = this.players[userId]?.points ?? 0;
    }

    this.result = await recordRankedResult({
      mode: this.rankedMode.id,
      roomName: this.name,
      players: this.rankedPlayers,
      scores
    });

    this.sendSocketMessage({
      type: 'ranked-match-complete',
      result: this.result
    });
  }

  sendRankedState (userId) {
    this.sendPrivateMessage(userId, {
      type: 'ranked-state',
      mode: this.rankedMode,
      questionCount: RANKED_QUESTION_COUNT,
      questionNumber: this.rankedQuestionIndex,
      players: this.rankedPlayers,
      matchComplete: this.matchComplete,
      result: this.result
    });
  }
}

export default RankedRoom;
