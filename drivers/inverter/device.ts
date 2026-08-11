import type { DiscoveryResult, DiscoveryStrategy } from 'homey';
import { isIP } from 'net';
import fetch from 'node-fetch';
import * as https from 'node:https';
import EnphaseDevice from '../../lib/EnphaseDevice.js';
import { XMLParser } from 'fast-xml-parser';

interface EnphaseDiscoveryResult extends DiscoveryResult {
  address: string;
  txt: {
    serialnum: string;
  };
}

interface EnphaseLocalProductionData {
  production: {
    type: string;
    wNow: number;
    whLifetime: number;
  }[];
}

export default class EnphaseDeviceInverter extends EnphaseDevice {
  private localAgent = new https.Agent({
    rejectUnauthorized: false,
  });
  private localSerialNumber: string | null = null;
  private localAddress: string | null = null;
  private localToken: string | null = null;
  private discoveryStrategy?: DiscoveryStrategy;

  public async onInit(): Promise<void> {
    const { siteId } = this.getData();
    this.log(`Site ID: ${siteId}`);

    // Load previous values from settings
    this.localAddress = this.getSettings().envoy_ip;
    this.localSerialNumber = this.getSettings().envoy_serial;

    await super.onInit();

    if ((this.homey.platform ?? 'local') === 'local') {
      this.discoveryStrategy = this.homey.discovery.getStrategy('enphase-envoy');
      this.discoveryStrategy.on('result', discoveryResult => {
        this.onDiscoveryResult(discoveryResult);
      });

      const discoveryResults = this.discoveryStrategy.getDiscoveryResults();
      for (const discoveryResult of Object.values(discoveryResults)) {
        this.onDiscoveryResult(discoveryResult as EnphaseDiscoveryResult);
      }
    }
  }

  protected async onPollCloud(): Promise<void> {
    await super.onPollCloud();

    const { siteId } = this.getData();

    const siteData = await this.api.getSiteData({ siteId });
    const todayData = await this.api.getSiteToday({ siteId });

    // This has been commented out because the data did not correspond to the actual power generation :(
    // const measurePower = todayData?.latest_power?.value; // in W
    // if (typeof measurePower === 'number') {
    //   await this.setCapabilityValue('measure_power', measurePower)
    //     .catch(err => this.error('Error setting measure_power:', err));
    // }

    const meterPower = siteData?.module?.lifetime?.lifetimeEnergy?.value; // in Wh
    if (typeof meterPower === 'number') {
      await this.setCapabilityValue('meter_power', meterPower / 1000).catch(err =>
        this.error('Error setting meter_power:', err),
      );
    }

    const meterPowerDay = todayData?.stats?.[0]?.totals?.production; // in Wh
    if (typeof meterPowerDay === 'number') {
      await this.setCapabilityValue('meter_power.day', meterPowerDay / 1000).catch(err =>
        this.error('Error setting meter_power.day:', err),
      );
    }
  }

  protected async onPollLocal(): Promise<void> {
    await super.onPollLocal();

    if (!this.localAddress) {
      this.debug('No local address found, skipping local polling.');
      // Without the local address, we cannot proceed with local polling
      return;
    }

    if (!this.localSerialNumber) {
      this.debug('No local serial number found, attempting to retrieve from Envoy');
      // We do not have the serial number, so we should retrieve it from the Envoy
      const infoRes = await fetch(`https://${this.localAddress}/info`, {
        method: 'GET',
        agent: this.localAgent,
      });

      const info = new XMLParser().parse(await infoRes.text()) as { envoy_info?: { device?: { sn?: string } } };
      this.localSerialNumber = String(info.envoy_info?.device?.sn ?? '');
      if (this.localSerialNumber === '') {
        this.localSerialNumber = null;
      }
      this.scheduleSettingsUpdate();

      if (!this.localSerialNumber) {
        throw new Error('Could not retrieve serial number from Envoy');
      }
    }

    if (!this.localToken) {
      this.debug('No local token found, attempting to retrieve from Entrez');
      this.localToken = await this.api.getEntrezToken({
        serialNumber: this.localSerialNumber,
      });
    }

    const res = await fetch(`https://${this.localAddress}/production.json?details=1`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.localToken}`,
      },
      agent: this.localAgent,
    });

    switch (res.status) {
      case 200: {
        const body = (await res.json()) as EnphaseLocalProductionData;
        this.debug('Response from Envoy:', JSON.stringify(body));

        if (Array.isArray(body.production)) {
          const productionInverters = body.production.find(item => item.type === 'inverters');
          if (productionInverters) {
            if (typeof productionInverters.wNow === 'number') {
              await Promise.resolve()
                .then(async () => {
                  if (!this.hasCapability('measure_power')) {
                    await this.addCapability('measure_power');
                  }

                  await this.setCapabilityValue('measure_power', productionInverters.wNow);
                })
                .catch(err => this.error('Error Setting measure_power:', err));
            }

            // This is disabled, because it might interfere with the cloud values.
            // We don't want jumping insights.
            // if (typeof productionInverters.whLifetime === 'number') {
            //   await Promise.resolve().then(async () => {
            //     if (!this.hasCapability('meter_power')) {
            //       await this.addCapability('meter_power');
            //     }

            //     await this.setCapabilityValue('meter_power', productionInverters.whLifetime / 1000);
            //   }).catch(err => this.error('Error Setting meter_power:', err));
            // }
          }
        }

        break;
      }
      case 401: {
        this.log('Local Token Expired');
        this.localToken = null;
        break;
      }
      default: {
        throw new Error(res.statusText);
      }
    }
  }

  public onDiscoveryResult(discoveryResult: EnphaseDiscoveryResult): boolean {
    this.log(`Local Envoy Found: ${discoveryResult.address} — S/N: ${discoveryResult.txt.serialnum}`);

    if (this.localAddress === discoveryResult.address && this.localSerialNumber === discoveryResult.txt.serialnum) {
      this.debug('Local Envoy details unchanged');
      return true;
    } else {
      this.localToken = null;
      this.localAddress = discoveryResult.address;
      this.localSerialNumber = discoveryResult.txt.serialnum;
      this.scheduleSettingsUpdate();

      // Execute new poll
      this.pollLocal();
    }

    // Register address change listener
    discoveryResult.once('addressChanged', () => {
      this.log(`Local Envoy Address Changed: ${this.localAddress} → ${discoveryResult.address}`);
      this.localAddress = discoveryResult.address;
      this.scheduleSettingsUpdate();
    });

    return true;
  }

  public async onSettings({
    newSettings,
    changedKeys,
  }: {
    newSettings: { [p: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<void> {
    if (changedKeys.includes('envoy_ip')) {
      if ((this.homey.platform ?? 'local') !== 'local') {
        throw new Error(this.homey.__('error.local_only'));
      }

      const envoyIp: string | null = newSettings.envoy_ip as string;
      if (envoyIp && !isIP(envoyIp)) {
        this.error('Invalid IP entered', envoyIp);
        throw new Error(this.homey.__('error.invalid_ip'));
      }

      this.log('Envoy IP changed by user, resetting serial');
      this.localAddress = envoyIp;
      this.localSerialNumber = null;
      this.scheduleSettingsUpdate();
      this.pollLocal();
    }

    await super.onSettings({
      newSettings,
      changedKeys,
    });
  }

  private scheduleSettingsUpdate(): void {
    this.homey.setTimeout(() => {
      this.debug('Saving ip & serial to settings', this.localAddress, this.localSerialNumber);
      this.setSettings({
        envoy_ip: this.localAddress ?? '',
        envoy_serial: this.localSerialNumber ?? '',
      }).catch(this.error);
    }, 5000);
  }
}
