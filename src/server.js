const { createApp } = require("./app");

const PORT = Number(process.env.PORT || 3000);
const app = createApp();

app.listen(PORT, () => {
  console.log(`search service listening on ${PORT}`);
});
