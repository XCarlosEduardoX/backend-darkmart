module.exports = {
  routes: [
    {
      method: "POST",
      path: "/user-profile/change-email",
      handler: "user-profile.changeEmail",
      config: {
        policies: [],
        middlewares: [],
        auth: {
          scope: ['authenticated']
        }
      }
    },
    {
      method: "GET",
      path: "/user-profile/me",
      handler: "user-profile.getProfile",
      config: {
        policies: [],
        middlewares: [],
        auth: {
          scope: ['authenticated']
        }
      }
    }
  ]
};
