import EnphaseDevice from '../../lib/EnphaseDevice.mjs';

export default class EnphaseDeviceInverter extends EnphaseDevice {

  async onPoll() {
    await super.onPoll();

    const siteData = await this.api.getSiteData();
    const lifetimeEnergy = siteData?.module?.lifetime?.lifetimeEnergy?.value; // in Wh
    console.log('lifetimeEnergy', lifetimeEnergy);
    if (typeof lifetimeEnergy === 'number') {
      await this.setCapabilityValue('meter_power', lifetimeEnergy / 1000)
        .catch(err => this.error('Error setting meter_power:', err));
    }

    const todayData = await this.api.getSiteToday();
    const latestPower = todayData?.latest_power?.value; // in W
    if (typeof latestPower === 'number') {
      await this.setCapabilityValue('measure_power', latestPower)
        .catch(err => this.error('Error setting measure_power:', err));
    }

    const totalProductionToday = todayData?.stats?.[0]?.totals?.production;
    console.log('totalProductionToday', totalProductionToday);
    if (typeof totalProductionToday === 'number') {
      await this.setCapabilityValue('meter_power.day', totalProductionToday / 1000)
        .catch(err => this.error('Error setting meter_power.day:', err));
    }

  }

};