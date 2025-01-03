const clearDatabase = async () => {
    const models = Object.keys(strapi.models).filter((model) => !model.startsWith('strapi_'));
  
    for (const model of models) {
      try {
        const modelUID = `api::${model}.${model}`;
        await strapi.entityService.deleteMany(modelUID);
        console.log(`Deleted all records from ${model}`);
      } catch (error) {
        console.error(`Failed to delete records from ${model}:`, error);
      }
    }
  };
  
  module.exports = async () => {
    console.log('Clearing database...');
    await clearDatabase();
    console.log('Database cleared!');
  };
  