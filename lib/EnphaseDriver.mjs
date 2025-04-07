import Homey from 'homey';
import EnphaseAPI from './EnphaseAPI.mjs';

export default class EnphaseDriver extends Homey.Driver {

  async onPair(session) {
    const api = new EnphaseAPI();
    let username;
    let password;

    session.setHandler('login', async data => {
      username = data.username;
      password = data.password;

      try {
        await api.login({
          username,
          password,
        });
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
