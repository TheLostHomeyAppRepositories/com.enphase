import Homey from 'homey';
import EnphaseAPI from './EnphaseAPI.mjs';

export default class EnphaseDriver extends Homey.Driver {

  async onPair(session) {
    let api;
    let username;
    let password;

    session.setHandler('login', async data => {
      username = data.username;
      password = data.password;

      try {
        api = new EnphaseAPI({
          username,
          password,
        });
        await api.login();
        return true;
      } catch (err) {
        return false;
      }
    });

    session.setHandler('list_devices', async () => {
      const siteData = await api.getSiteData();

      return siteData.module.hamburger.sites.map(site => ({
        name: site.title,
        data: {
          siteId: site.id,
        },
        settings: {
          username,
          password,
        },
      }));
    });
  }

};
