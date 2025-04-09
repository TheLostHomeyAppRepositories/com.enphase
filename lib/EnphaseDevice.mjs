import Homey from 'homey';
import EnphaseAPI from './EnphaseAPI.mjs';

export default class EnphaseDevice extends Homey.Device {

  static POLL_INTERVAL = 1000 * 60; // 1 minute

  async onInit() {
    this.api = new EnphaseAPI({
      username: this.getSettings().username,
      password: this.getSettings().password,
    });

    this.pollInterval = setInterval(() => this.poll(), this.constructor.POLL_INTERVAL);
    this.poll();
  }

  async onUninit() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  }

  poll() {
    this.onPoll().catch(err => {
      this.error(`Error Polling: ${err.message}`);
      this.setUnavailable(err).catch(this.error);
    });
  }

  async onPoll() {
    // Overload Me
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('username') || changedKeys.includes('password')) {
      await this.api.login({
        username: newSettings.username,
        password: newSettings.password,
      });

      this.poll();
    }
  }

};
