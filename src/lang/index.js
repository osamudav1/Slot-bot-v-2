const enStrings = require("./strings.en");
const trStrings = require("./strings.tr");
const enCommandNames = require("./commands.en");
const trCommandNames = require("./commands.tr");

const supportedLanguages = ["tr", "en"];

const checkLanguageIsAvailable = () => {
  const lang = process.env.LANG || "en";
  return supportedLanguages.includes(lang);
};

const getCommandName = (stringName) => {
  const lang = process.env.LANG || "en";
  return lang === "tr" ? trCommandNames[stringName] : enCommandNames[stringName];
};

const getString = (stringName) => {
  const lang = process.env.LANG || "en";
  return lang === "tr" ? trStrings[stringName] : enStrings[stringName];
};

module.exports = { getString, getCommandName, checkLanguageIsAvailable };
