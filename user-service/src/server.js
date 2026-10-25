const { PORT } = require('./config');
const app = require('./app');

app.listen(PORT, ()=>{
    console.log(`Server is listening on ${PORT}`);
});
