const { connectQdrant, qdrantClient } = require('./services/qdrantService');

(async () => {
  await connectQdrant();

  const collections = await qdrantClient.collections.getAll();
  console.log('Collections:', collections);
})();
