import { URL } from 'url';
import fetch from 'node-fetch';

export default class EnphaseAPI {

  cookies = [];
  siteId = null;

  constructor({
    username = null,
    password = null,
  } = {}) {
    this.username = username;
    this.password = password;
  }

  isLoggedIn() {
    return this.cookies.length > 0;
  }

  async login({
    username = this.username,
    password = this.password,
  } = []) {
    if (!username) {
      throw new Error('Missing Username');
    }

    if (!password) {
      throw new Error('Missing Password');
    }

    const res = await fetch('https://enlighten.enphaseenergy.com/login/login', {
      method: 'POST',
      body: new URLSearchParams({
        'user[email]': username,
        'user[password]': password,
      }),
      redirect: 'manual',
    });

    if (res.status !== 302) {
      throw new Error('Invalid e-mail and/or password.');
    }

    this.cookies = res.headers.raw()['set-cookie'].map(cookie => cookie.split(';')[0]);

    const location = res.headers.get('location');
    if (!location) {
      throw new Error('Missing Location Header');
    }

    const locationUrl = new URL(location);
    const locationUrlPathname = locationUrl.pathname.split('/');
    const siteId = Number(locationUrlPathname[locationUrlPathname.length - 1]);
    if (!siteId) {
      throw new Error('Missing Site ID');
    }

    if (typeof siteId !== 'number' || Number.isNaN(siteId)) {
      throw new Error('Invalid Site ID');
    }

    this.siteId = siteId;

    return { siteId };
  }

  async getSiteData({
    siteId,
  } = {}) {
    if (!this.isLoggedIn()) {
      await this.login();
    }

    if (!siteId) {
      siteId = this.siteId;
    }

    if (!siteId) {
      throw new Error('Missing Site ID');
    }

    const res = await fetch(`https://enlighten.enphaseenergy.com/app-api/${siteId}/data.json`, {
      headers: {
        Cookie: this.cookies.join('; '),
      },
    });

    if (res.status === 401) {
      this.cookies = [];
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      throw new Error(res.statusText ?? 'Error Getting Site Data');
    }

    return await res.json();
  }

  async getSiteToday({
    siteId = this.siteId,
  } = {}) {
    if (!this.isLoggedIn()) {
      await this.login();
    }

    if (!siteId) {
      siteId = this.siteId;
    }

    if (!siteId) {
      throw new Error('Missing Site ID');
    }

    const res = await fetch(`https://enlighten.enphaseenergy.com/pv/systems/${siteId}/today`, {
      headers: {
        Cookie: this.cookies.join('; '),
      },
    });

    if (res.status === 401) {
      this.cookies = [];
      throw new Error('Unauthorized');
    }

    if (!res.ok) {
      throw new Error(res.statusText ?? 'Error Getting Site Today');
    }

    return await res.json();
  }

}