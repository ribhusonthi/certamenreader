// Sets created within this many days are flagged "new" in pickers.
const NEW_SET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export default class api {
  static SET_LIST = [];
  static SET_META = {};

  static async readJson (response) {
    if (response.status === 401) {
      window.location.href = '/user/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search);
      throw new Error('Authentication required.');
    }

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    return await response.json();
  }

  /**
   * @param {string} setName
   * @returns {boolean} true if the named set was created within the last week.
   */
  static isSetNew (setName) {
    const meta = api.SET_META?.[setName];
    if (!meta?.createdAt) return false;
    const t = Date.parse(meta.createdAt);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < NEW_SET_WINDOW_MS;
  }

  /**
   * @param {string} setName
   * @returns {boolean} true if the named set is a private upload of the
   *   signed-in user (the API only lists private sets to their owner).
   */
  static isSetPrivate (setName) {
    return api.SET_META?.[setName]?.private === true;
  }

  /**
     * @param {string} answerline
     * @param {string} givenAnswer
     * @returns {Promise<{
        * directive: "accept" | "prompt" | "reject",
        * directedPrompt: String | null
    * }>}
    */
  static async checkAnswer (answerline, givenAnswer) {
    if (typeof givenAnswer !== 'string' || givenAnswer.trim() === '') {
      return { directive: 'reject', directedPrompt: null };
    }

    return await fetch('/api/check-answer?' + new URLSearchParams({ answerline, givenAnswer }))
      .then(response => api.readJson(response));
  }

  /**
     * @param {String} setName
     * @returns {Promise<Number>} The number of packets in the set.
     */
  static async getNumPackets (setName) {
    if (setName === undefined || setName === '') {
      return 0;
    }

    return await fetch('/api/num-packets?' + new URLSearchParams({ setName }))
      .then(response => api.readJson(response))
      .then(data => data.numPackets);
  }

  /**
     * @param {String} setName
     * @returns {Promise<{name: string, number: number}[]>} The list of packets in the set.
     */
  static async getPacketList (setName) {
    if (setName === undefined || setName === '') {
      return [];
    }

    return await fetch('/api/packet-list?' + new URLSearchParams({ setName }))
      .then(response => api.readJson(response))
      .then(data => data.packets);
  }

  /**
     * @param {string} setName - The name of the set.
     * @param {string | number} packetNumber - The packet number of the set.
     * @return {Promise<JSON[]>} An array containing the bonuses.
     */
  static async getPacketBonuses (setName, packetNumber) {
    if (setName === '') {
      return [];
    }

    return await fetch('/api/packet-bonuses?' + new URLSearchParams({ setName, packetNumber }))
      .then(response => api.readJson(response))
      .then(data => data.bonuses);
  }

  /**
     * @param {string} setName - The name of the set.
     * @param {string} packetNumber - The packet number of the set.
     * @return {Promise<JSON[]>} An array containing the tossups.
     */
  static async getPacketTossups (setName, packetNumber) {
    if (setName === '') {
      return [];
    }

    return await fetch('/api/packet-tossups?' + new URLSearchParams({ setName, packetNumber }))
      .then(response => api.readJson(response))
      .then(data => data.tossups);
  }

  /**
   * Fetch the bonus linked to a specific tossup.
   * @param {string} setName
   * @param {number} packetNumber
   * @param {number} tossupNumber
   * @returns {Promise<object|null>} The bonus object, or null if none exists.
   */
  static async getBonusForTossup (setName, packetNumber, tossupNumber) {
    if (!setName || packetNumber == null || tossupNumber == null) return null;

    return await fetch('/api/bonus-for-tossup?' + new URLSearchParams({ setName, packetNumber, tossupNumber }))
      .then(response => api.readJson(response))
      .then(data => data.bonus);
  }

  static async getRandomBonus ({ alternateSubcategories, categories, difficulties, maxYear, minYear, number, rounds = [], subcategories, threePartBonuses }) {
    return await fetch('/api/random-bonus?' + new URLSearchParams({ alternateSubcategories, categories, difficulties, maxYear, minYear, number, rounds, subcategories, threePartBonuses }))
      .then(response => api.readJson(response))
      .then(response => response.bonuses);
  }

  /**
     *
     * @returns {Promise<string>} A random adjective-noun pair that can be used as a name.
     */
  static async getRandomName () {
    return await fetch('/api/random-name')
      .then(response => api.readJson(response))
      .then(data => data.randomName);
  }

  static async getRandomTossup ({ alternateSubcategories, categories, difficulties, maxYear, minYear, number, rounds = [], setNames, standardOnly, subcategories }) {
    return await fetch('/api/random-tossup?' + new URLSearchParams({ alternateSubcategories, categories, difficulties, maxYear, minYear, number, rounds, setNames: Array.isArray(setNames) ? JSON.stringify(setNames) : setNames, standardOnly, subcategories }))
      .then(response => api.readJson(response))
      .then(response => response.tossups);
  }

  static getSetList () {
    return api.SET_LIST;
  }

  static async updateTossup (_id, fields) {
    return await fetch('/api/admin/update-tossup', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id, ...fields })
    });
  }

  static reportQuestion (_id, reason, description) {
    document.getElementById('report-question-submit').disabled = true;
    fetch('/api/report-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _id, reason, description })
    }).then(response => {
      if (response.status === 200) {
        const reasonSelect = document.getElementById('report-question-reason');
        if (reasonSelect) reasonSelect.value = 'wrong-category';
        document.querySelectorAll('.report-question-reason').forEach(input => {
          input.checked = false;
        });
        document.getElementById('report-question-description').value = '';
        window.alert('Question has been reported.');
      } else {
        window.alert('There was an error reporting the question.');
      }
    }).catch(_error => {
      window.alert('There was an error reporting the question.');
    }).finally(() => {
      document.getElementById('report-question-close').click();
      document.getElementById('report-question-submit').disabled = false;
    });
  }
}

const setListResponse = await fetch('/api/set-list').then(response => api.readJson(response));
api.SET_LIST = setListResponse.setList || [];
api.SET_META = setListResponse.setMeta || {};
