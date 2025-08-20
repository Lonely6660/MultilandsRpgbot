/**
 * Rolls dice based on a given notation (e.g., "1d4", "2d6+3").
 * @param {string} diceNotation - The dice string (e.g., "1d4", "2d6+3").
 * @returns {{total: number, rolls: number[], maxRoll: boolean, maxPossible: number}} - Object with total, individual rolls, and if it was a max roll.
 */
function rollDice(diceNotation) {
  const match = diceNotation.match(/^(\d+)d(\d+)(?:([+-]\d+))?$/);
  if (!match) {
    throw new Error('Invalid dice notation. Use format like "1d4" or "2d6+3".');
  }

  const numDice = parseInt(match[1], 10);
  const dieSize = parseInt(match[2], 10);
  const modifier = match[3] ? parseInt(match[3], 10) : 0;

  let total = 0;
  const rolls = [];
  let isPerfectRoll = true;

  for (let i = 0; i < numDice; i++) {
    const roll = Math.floor(Math.random() * dieSize) + 1;
    rolls.push(roll);
    total += roll;
    if (roll !== dieSize) {
      isPerfectRoll = false;
    }
  }

  total += modifier;
  return {
    total: total,
    rolls: rolls,
    maxRoll: isPerfectRoll,
    maxPossible: numDice * dieSize + modifier
  };
}

/**
 * Calculates the current damage dice for an attack based on its base dice and level.
 * @param {string} baseDice - The base dice notation (e.g., '1d4').
 * @param {number} level - The attack's current level.
 * @returns {string} The new dice notation.
 */
function calculateDamageDice(baseDice, level) {
  const match = baseDice.match(/^(\d+)d(\d+)$/);
  if (!match) return baseDice;

  const numDice = parseInt(match[1], 10);
  const dieSize = parseInt(match[2], 10);
  const newDieSize = dieSize + level;
  
  return `${numDice}d${newDieSize}`;
}

module.exports = { rollDice, calculateDamageDice };
