const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const router = require("./routes/index.js");
app.use("/service/user-service",router);

app.listen(PORT, ()=>{
    console.log(`Server is listening on ${PORT}`);
});
