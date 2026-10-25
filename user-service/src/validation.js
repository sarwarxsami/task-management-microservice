const STUDENT_ID = /^[A-Za-z0-9_-]{1,50}$/;

function validName(name) {
    return typeof name === "string" && name.trim().length > 0 && name.trim().length <= 100;
}

function validStudentId(studentId) {
    return typeof studentId === "string" && STUDENT_ID.test(studentId);
}

function validPassword(password) {
    return typeof password === "string" && password.length >= 8 && password.length <= 72;
}

module.exports = { validName, validStudentId, validPassword };
