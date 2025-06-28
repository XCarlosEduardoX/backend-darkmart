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
    },
    {
      method: "POST",
      path: "/user-profile/change-role",
      handler: "user-profile.changeUserRole",
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
      path: "/user-profile/roles",
      handler: "user-profile.getRoles",
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
