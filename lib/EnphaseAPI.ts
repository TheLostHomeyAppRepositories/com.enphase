import { URLSearchParams, URL } from 'url';
import fetch from 'node-fetch';

interface EnphaseCredentials {
  username?: string;
  password?: string;
}

interface EnphaseTokenRequest extends EnphaseCredentials {
  serialNumber: string | null;
}

export interface EnphaseSiteData {
  module?: {
    info?: {
      title: string | null;
    };
    lifetime?: {
      lifetimeEnergy?: {
        value: number | null;
      };
    };
  };
}

export interface EnphaseSiteTodayData {
  stats?: {
    [key: string]: {
      totals?: {
        production?: number;
        consumption?: number;
        import?: number;
        export?: number;
        charge?: number;
        discharge?: number;
      };
    };
  };
  latest_power?: {
    value: number | null;
  };
  connectionDetails?: {
    [key: number]: {
      ethernet?: boolean;
      wifi?: boolean | string;
      cellular?: boolean;
    };
  };
  battery_details?: {
    aggregate_soc?: number;
  };
  last_report_date?: number;
}

export default class EnphaseAPI {
  private cookies: string[] = [];
  private headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  };
  private username?: string;
  private password?: string;

  public constructor({ username, password }: EnphaseCredentials) {
    this.username = username;
    this.password = password;
  }

  public isLoggedIn(): boolean {
    return this.cookies.length > 0;
  }

  public async login({ username = this.username, password = this.password } = {}): Promise<void> {
    if (!username) {
      throw new Error('Missing username');
    }

    if (!password) {
      throw new Error('Missing password');
    }

    const res = await fetch('https://enlighten.enphaseenergy.com/login/login', {
      method: 'POST',
      headers: { ...this.headers },
      body: new URLSearchParams({
        'user[email]': username,
        'user[password]': password,
      }),
      redirect: 'manual',
    });

    if (res.status !== 302) {
      throw new Error(
        'Invalid e-mail and/or password. If you have 2FA enabled make sure to disable that in order to use this Homey app.',
      );
    }

    this.cookies = res.headers.raw()['set-cookie'].map(cookie => cookie.split(';')[0]);
  }

  public async loginJSON({ username = this.username, password = this.password } = {}): Promise<{ session_id: string }> {
    if (!username) {
      throw new Error('Missing Username');
    }

    if (!password) {
      throw new Error('Missing Password');
    }

    const res = await fetch('https://enlighten.enphaseenergy.com/login/login.json', {
      method: 'POST',
      headers: {
        ...this.headers,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        'user[email]': username,
        'user[password]': password,
      }),
    });

    if (!res.ok) {
      throw new Error(res.statusText);
    }

    return (await res.json()) as { session_id: string };
  }

  public async getSiteIds(): Promise<number[]> {
    if (!this.isLoggedIn()) {
      await this.login();
    }

    const res = await fetch('https://enlighten.enphaseenergy.com/systems.js', {
      method: 'GET',
      headers: {
        ...this.headers,
        Cookie: this.cookies.join('; '),
      },
      redirect: 'manual',
    });

    if (res.status === 401) {
      this.cookies = [];
      throw new Error('Unauthorized');
    }

    const location = res.headers.get('Location');
    const contentType = res.headers.get('Content-Type');

    // If there's only one system, we need to get the siteId from the Location header
    if (location) {
      const locationUrl = new URL(location);
      const locationUrlPathname = locationUrl.pathname.split('/');
      const siteId = Number(locationUrlPathname[locationUrlPathname.length - 1]);
      if (!siteId) {
        throw new Error('Missing Site ID');
      }

      if (typeof siteId !== 'number' || Number.isNaN(siteId)) {
        throw new Error('Invalid Site ID');
      }

      return [siteId];
    }

    // If there are multiple systems, we need to get the siteIds from the JSON response
    if (contentType?.includes('text/javascript')) {
      const json = (await res.json()) as { map_data: { id: number }[] };

      if (!Array.isArray(json.map_data)) {
        throw new Error('Invalid Map Data');
      }

      return json.map_data.map(system => system.id);
    }

    throw new Error('Error Getting Site IDs');
  }

  public async getSiteData({ siteId }: { siteId: number }): Promise<EnphaseSiteData> {
    if (!this.isLoggedIn()) {
      await this.login();
    }

    if (!siteId) {
      throw new Error('Missing Site ID');
    }

    const res = await fetch(`https://enlighten.enphaseenergy.com/app-api/${siteId}/data.json`, {
      headers: {
        ...this.headers,
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

    return (await res.json()) as EnphaseSiteData;
  }

  public async getSiteToday({ siteId }: { siteId: number }): Promise<EnphaseSiteTodayData> {
    if (!this.isLoggedIn()) {
      await this.login();
    }

    if (!siteId) {
      throw new Error('Missing Site ID');
    }

    const res = await fetch(`https://enlighten.enphaseenergy.com/pv/systems/${siteId}/today`, {
      headers: {
        ...this.headers,
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

    return (await res.json()) as EnphaseSiteTodayData;
  }

  public async getEntrezToken({
    username = this.username,
    password = this.password,
    serialNumber = null,
  }: EnphaseTokenRequest): Promise<string> {
    if (!username) {
      throw new Error('Missing Username');
    }

    if (!serialNumber) {
      throw new Error('Missing Serial Number');
    }

    const { session_id } = await this.loginJSON({
      username,
      password,
    });

    const res = await fetch('https://entrez.enphaseenergy.com/tokens', {
      method: 'POST',
      headers: {
        ...this.headers,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username,
        session_id,
        serial_num: serialNumber,
      }),
    });

    if (!res.ok) {
      throw new Error(res.statusText);
    }

    return await res.text();
  }
}
