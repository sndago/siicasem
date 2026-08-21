const titleCase = (str) =>
  typeof str === 'string'
    ? str.replace(/\w\S*/g, (word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    : str;

module.exports = titleCase;
