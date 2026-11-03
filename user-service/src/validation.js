const USERNAME = /^[a-z0-9_]{3,30}$/;
const GMAIL = /^[a-z0-9][a-z0-9.+_-]{0,63}@gmail\.com$/;

function validName(name) {
    return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100;
}

// Emails are stored lowercase
function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validGmail(email) {
    return GMAIL.test(email);
}

// Usernames are stored lowercase
function normalizeUsername(username) {
    return typeof username === "string" ? username.trim().toLowerCase() : "";
}

function validUsername(username) {
    return USERNAME.test(username);
}

function validPassword(password) {
    return typeof password === "string" && password.length >= 8 && password.length <= 72;
}

module.exports = { validName, validPassword, normalizeUsername, validUsername, normalizeEmail, validGmail };
