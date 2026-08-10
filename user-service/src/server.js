const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.json());

const router = require("./routes/index.js");
app.use("/service",router);
app.use(express.json());

app.listen(PORT, ()=>{
    console.log('Server is listening on ${PORT}');
});