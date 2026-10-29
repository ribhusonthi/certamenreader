import { packetMatchesRounds, sanitizeRounds } from './rounds.js';

const SUBCATEGORIES = {
  Mythology: [],
  'Roman History': [],
  'Latin Literature': [],
  Language: [],
  Culture: []
};

export default class CategoryManager {
  /**
     * @param {string[]} categories
     * @param {string[]} subcategories
     * @param {string[]} alternateSubcategories
     * @param {string[]} rounds - independent of categories: any mix of the two is allowed.
     */
  constructor (categories = [], subcategories = [], alternateSubcategories = [], rounds = []) {
    this.import(categories, subcategories, alternateSubcategories, rounds);
  }

  export () {
    return {
      categories: this.categories,
      subcategories: this.subcategories,
      alternateSubcategories: this.alternateSubcategories,
      rounds: this.rounds
    };
  }

  import (categories = [], subcategories = [], alternateSubcategories = [], rounds = []) {
    if (categories.length > 0 && subcategories.length === 0) {
      categories.forEach(category => {
        SUBCATEGORIES[category]?.forEach(subcategory => {
          subcategories.push(subcategory);
        });
      });
    }

    this.categories = categories;
    this.subcategories = subcategories;
    this.alternateSubcategories = alternateSubcategories;
    this.rounds = sanitizeRounds(rounds);
  }

  /**
     * @param {JSON} question
     * @returns {boolean} Whether or not the question is part of the valid category, subcategory and round combination.
     */
  isValidCategory (question) {
    if (this.categories.length === 0 && this.subcategories.length === 0 && this.rounds.length === 0) {
      return true;
    }

    const categoryMatch = this.categories.length === 0 || this.categories.includes(question.category);
    const subcategoryMatch = this.subcategories.length === 0 || this.subcategories.includes(question.subcategory);
    const roundMatch = packetMatchesRounds(question.packet?.name, this.rounds);
    return categoryMatch && subcategoryMatch && roundMatch;
  }

  /**
     * Updates the category modal to show the given categories and subcategories.
     * @returns {void}
     */
  loadCategoryModal () {
    document.querySelectorAll('#categories input').forEach(element => { element.checked = false; });
    document.querySelectorAll('#subcategories input').forEach(element => { element.checked = false; });
    document.querySelectorAll('#subcategories label').forEach(element => { element.classList.add('d-none'); });
    document.querySelectorAll('#alternate-subcategories input').forEach(element => { element.checked = false; });
    document.querySelectorAll('#alternate-subcategories label').forEach(element => { element.classList.add('d-none'); });
    document.querySelectorAll('#rounds input').forEach(element => {
      element.checked = this.rounds.includes(element.dataset.round);
    });

    for (const category of this.categories) {
      const input = document.querySelector(`#categories [data-category="${category}"]`);
      if (input) input.checked = true;
      SUBCATEGORIES[category]?.forEach(subcategory => {
        document.querySelector(`[for="${subcategory}"]`)?.classList.remove('d-none');
      });
    }

    for (const subcategory of this.subcategories) {
      document.getElementById(subcategory).checked = true;
    }

    for (const alternateSubcategory of this.alternateSubcategories) {
      document.getElementById(alternateSubcategory).checked = true;
    }

    document.querySelectorAll('#category-chips .cat-chip').forEach(chip => {
      const checkboxId = chip.dataset.checkboxId;
      const checkbox = checkboxId ? document.getElementById(checkboxId) : null;
      chip.setAttribute('data-on', checkbox?.checked ? 'true' : 'false');
    });
  }

  /**
     * Adds the given category if it is not in the list of valid categories.
     * Otherwise, the category is removed.
     * @param {string} category
     * @returns {boolean} true if the category was added, false if the category was removed
     */
  updateCategory (category) {
    if (this.categories.includes(category)) {
      this.categories = this.categories.filter(a => a !== category);
      this.subcategories = this.subcategories.filter(a => !SUBCATEGORIES[category].includes(a));
      // this.alternateSubcategories = this.alternateSubcategories.filter(a => !ALTERNATE_SUBCATEGORIES[category].includes(a));
      return false;
    } else {
      this.categories.push(category);
      this.subcategories = this.subcategories.concat(SUBCATEGORIES[category]);
      // this.alternateSubcategories = this.alternateSubcategories.concat(ALTERNATE_SUBCATEGORIES[category]);
      return true;
    }
  }

  /**
     * Adds the given round if it is not selected. Otherwise, the round is removed.
     * @param {string} round
     * @returns {boolean} true if the round was added, false if the round was removed
     */
  updateRound (round) {
    if (this.rounds.includes(round)) {
      this.rounds = this.rounds.filter(a => a !== round);
      return false;
    } else {
      this.rounds = sanitizeRounds([...this.rounds, round]);
      return true;
    }
  }

  /**
     * Adds the given subcategory if it is not in the list of valid subcategories.
     * Otherwise, the subcategory is removed.
     * @param {String} subcategory
     */
  updateSubcategory (subcategory) {
    if (this.subcategories.includes(subcategory)) {
      this.subcategories = this.subcategories.filter(a => a !== subcategory);
      return false;
    } else {
      this.subcategories.push(subcategory);
      return true;
    }
  }

  /**
     * Adds the given subcategory if it is not in the list of valid subcategories.
     * Otherwise, the subcategory is removed.
     * @param {String} alternateSubcategory
     */
  updateAlternateSubcategory (alternateSubcategory) {
    if (this.alternateSubcategories.includes(alternateSubcategory)) {
      this.alternateSubcategories = this.alternateSubcategories.filter(a => a !== alternateSubcategory);
      return false;
    } else {
      this.alternateSubcategories.push(alternateSubcategory);
      return true;
    }
  }
}
