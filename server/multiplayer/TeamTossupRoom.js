import TossupRoom from './TossupRoom.js';
import { ROOM_NAME_MAX_LENGTH } from './constants.js';

import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
const DOMPurify = createDOMPurify(new JSDOM('').window);

const teamTossupRooms = {};

const MIN_TEAMS = 2;
const MAX_TEAMS = 4;
const DEFAULT_TEAM_NAMES = ['Red', 'Blue', 'Green', 'Gold'];

/**
 * Team-mode tossup room.
 *
 * Adds three pieces of state on top of TossupRoom:
 *   1. `teamCount` and `teamNames`  — fixed at room creation, 2..4 teams.
 *   2. `playerTeam: {userId: number}` — which team each player is on.
 *   3. `lockedTeams: Set<number>`   — teams that may not buzz on the current
 *      tossup because one of their players already attempted it.
 *
 * `lockedTeams` is cleared whenever a new question starts (see `next` /
 * `readQuestion` overrides). On a correct buzz the question ends, so the
 * set is reset there too — the practical effect is "first team to buzz
 * locks itself; if they neg, the remaining teams keep going".
 */
class TeamTossupRoom extends TossupRoom {
  constructor (name, teamCount = 2, teamNames = []) {
    super(name, false);
    this.isTeamRoom = true;

    const clampedCount = Math.max(MIN_TEAMS, Math.min(MAX_TEAMS, teamCount | 0 || 2));
    this.teamCount = clampedCount;
    this.teamNames = Array.from({ length: clampedCount }, (_, i) =>
      (teamNames[i] && String(teamNames[i]).trim()) || DEFAULT_TEAM_NAMES[i] || `Team ${i + 1}`
    );

    /** @type {Object<string, number>} userId → team index (0..teamCount-1) */
    this.playerTeam = {};
    /** @type {Set<number>} teams locked from buzzing on the current tossup */
    this.lockedTeams = new Set();
    /** @type {Object<string, string | null>} userId → schoolId (for auto-assign) */
    this.playerSchool = {};
  }

  // ── Team management ───────────────────────────────────────────────────────

  /**
   * Pick a team for a newly-joined player. Prefers the team with the most
   * existing members from the same school; falls back to the smallest team.
   */
  pickTeamForPlayer (userId) {
    const mySchool = this.playerSchool[userId] || null;
    const sizes = new Array(this.teamCount).fill(0);
    const sameSchool = new Array(this.teamCount).fill(0);
    for (const [otherId, teamIdx] of Object.entries(this.playerTeam)) {
      if (otherId === userId) continue;
      sizes[teamIdx]++;
      if (mySchool && this.playerSchool[otherId] === mySchool) {
        sameSchool[teamIdx]++;
      }
    }
    // Prefer max same-school, tiebreak by smallest team.
    let best = 0;
    for (let i = 1; i < this.teamCount; i++) {
      if (
        sameSchool[i] > sameSchool[best] ||
        (sameSchool[i] === sameSchool[best] && sizes[i] < sizes[best])
      ) {
        best = i;
      }
    }
    return best;
  }

  setPlayerTeam (userId, teamIdx) {
    if (typeof teamIdx !== 'number' || teamIdx < 0 || teamIdx >= this.teamCount) return;
    this.playerTeam[userId] = teamIdx;
    this.sendSocketMessage({
      type: 'team-assign',
      userId,
      team: teamIdx,
      teamName: this.teamNames[teamIdx]
    });
  }

  // ── Hooks into the base room ──────────────────────────────────────────────

  /**
   * Override createPlayer so first-time joiners get auto-placed onto a team.
   * The school-aware pick is what gives us "auto-assign by school" for free —
   * playerSchool is set from the URL params by handle-wss-connection.
   */
  createPlayer (userId) {
    super.createPlayer(userId);
    if (!(userId in this.playerTeam)) {
      this.playerTeam[userId] = this.pickTeamForPlayer(userId);
    }
  }

  /**
   * Per-team buzz lockout. If the buzzing player's team has already attempted
   * this tossup, drop the buzz on the floor — same UX as someone losing the
   * race in solo mode (other team's player can still buzz).
   */
  buzz (userId) {
    const team = this.playerTeam[userId];
    if (team !== undefined && this.lockedTeams.has(team)) {
      // Tell just the buzzing socket — no need to broadcast.
      const socket = this.sockets[userId];
      if (socket) {
        socket.send(JSON.stringify({
          type: 'team-locked',
          team,
          teamName: this.teamNames[team]
        }));
      }
      return;
    }
    super.buzz(userId);
  }

  /**
   * After the base class resolves the answer, lock the team out (on reject)
   * or clear locks (on accept — the tossup is over anyway).
   */
  giveAnswer (userId, givenAnswer) {
    const team = this.playerTeam[userId];
    // Snapshot directive by hooking after super: easiest is to inspect post-
    // state — if the answer was accepted, the question advances and we'll
    // reset locks on next. If rejected, the room keeps reading and we must
    // lock the team here. Detect via `buzzedIn` going back to null + the
    // questionProgress not being ANSWER_REVEALED.
    const wasBuzzedIn = this.buzzedIn === userId;
    super.giveAnswer(userId, givenAnswer);
    if (!wasBuzzedIn) return;
    // After super, if the question is still being read (no answer revealed),
    // it means the buzz was rejected/prompt-failed → lock this team out.
    if (team !== undefined && this.buzzedIn === null && !this.tossupRevealed()) {
      this.lockedTeams.add(team);
      // If every team is now locked, end the tossup so we don't dead-time.
      if (this.lockedTeams.size >= this.teamCount) {
        this.revealQuestion();
      } else {
        this.sendSocketMessage({
          type: 'team-locked-out',
          team,
          teamName: this.teamNames[team]
        });
      }
    }
  }

  tossupRevealed () {
    // `questionProgress` is private to TossupRoom — we read it via the public
    // shape that gets serialized into connection-acknowledged. Value 2 ==
    // QuestionProgressEnum.ANSWER_REVEALED in TossupRoom.js.
    return this.questionProgress === 2;
  }

  async next (userId, type) {
    // Always clear locks at the start of a fresh question. Calling super after
    // means the new tossup is already lock-free when clients hear about it.
    this.lockedTeams.clear();
    return super.next(userId, type);
  }

  // ── Network shape ─────────────────────────────────────────────────────────

  /**
   * Extend the base join broadcast so clients learn team assignments and
   * the team-name list. We can't easily augment `connection-acknowledged`
   * without rewriting it, so we send a follow-up `team-state` message that
   * the client merges into its world.
   */
  connection (socket, userId, username, verifiedUsername = null) {
    const isNew = !(userId in this.players);
    super.connection(socket, userId, username, verifiedUsername);
    if (isNew) {
      // Tell everyone about the new player's team.
      this.sendSocketMessage({
        type: 'team-assign',
        userId,
        team: this.playerTeam[userId],
        teamName: this.teamNames[this.playerTeam[userId]]
      });
    }
    socket.send(JSON.stringify({
      type: 'team-state',
      teamCount: this.teamCount,
      teamNames: this.teamNames,
      teams: this.playerTeam,
      lockedTeams: Array.from(this.lockedTeams)
    }));
  }

  /**
   * Handle the one new message type clients send: switching teams.
   * Everything else delegates to the base class.
   */
  message (userId, message) {
    if (message && message.type === 'select-team') {
      const team = Number(message.team);
      if (
        Number.isInteger(team) &&
        team >= 0 &&
        team < this.teamCount &&
        !this.buzzedIn // can't team-hop mid-question
      ) {
        this.setPlayerTeam(userId, team);
      }
      return;
    }
    return super.message(userId, message);
  }
}

/**
 * Get or create a team room. teamCount is only honored on first creation —
 * subsequent joiners are bound to the count chosen by the first creator.
 */
function createAndReturnTeamRoom (roomName, teamCount = 2, teamNames = [], isPrivate = false) {
  roomName = DOMPurify.sanitize(roomName);
  roomName = roomName?.substring(0, ROOM_NAME_MAX_LENGTH) ?? '';
  if (!Object.prototype.hasOwnProperty.call(teamTossupRooms, roomName)) {
    const room = new TeamTossupRoom(roomName, teamCount, teamNames);
    room.settings.public = !isPrivate;
    teamTossupRooms[roomName] = room;
  }
  return teamTossupRooms[roomName];
}

export { TeamTossupRoom, createAndReturnTeamRoom, teamTossupRooms, MIN_TEAMS, MAX_TEAMS };
