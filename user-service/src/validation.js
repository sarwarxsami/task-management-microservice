const STUDENT_ID = /^[A-Za-z0-9_-]{1,50}$/;
const USERNAME = /^[a-z0-9_]{3,30}$/;

function validName(name) {
    return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100;
}

function validStudentId(studentId) {
    return typeof studentId === "string" && STUDENT_ID.test(studentId);
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

module.exports = { validName, validStudentId, validPassword, normalizeUsername, validUsername };
