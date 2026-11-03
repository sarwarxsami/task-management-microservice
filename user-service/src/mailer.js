const nodemailer = require('nodemailer');
const { SMTP } = require('./config');

const transport = SMTP.user && nodemailer.createTransport({
    host: SMTP.host,
    port: SMTP.port,
    secure: SMTP.port === 465,
    auth: SMTP.pass ? { user: SMTP.user, pass: SMTP.pass } : undefined,
    connectionTimeout: 10000,
    socketTimeout: 10000,
});

const mailer = {
    // false until SMTP_USER is set; the service still runs, only sending codes is unavailable
    configured: () => Boolean(transport),

    sendCode(to, code) {
        return transport.sendMail({
            from: `"TMS" <${SMTP.user}>`,
            to,
            subject: `Your TMS code is ${code}`,
            text: `Your TMS code is ${code}.\n\nIt expires in 10 minutes. If you did not ask for it, you can ignore this email.\n`,
        });
    },
};

module.exports = mailer;
