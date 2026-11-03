const USERNAME = /^[a-z0-9_]{3,30}$/;
const EMAIL = /^[a-z0-9][a-z0-9.+_-]{0,63}@([a-z0-9-]+\.)+[a-z]{2,}$/;

function validName(name) {
    return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100;
}

// Emails are stored lowercase
function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}

function validEmail(email) {
    return email.length <= 254 && EMAIL.test(email);
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

module.exports = { validName, validPassword, normalizeUsername, validUsername, normalizeEmail, validEmail };
