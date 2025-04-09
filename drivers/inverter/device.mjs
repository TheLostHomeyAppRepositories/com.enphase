import EnphaseDevice from '../../lib/EnphaseDevice.mjs';

export default class EnphaseDeviceInverter extends EnphaseDevice {

  async onPoll() {
    await super.onPoll();

    const siteData = await this.api.getSiteData();
    const todayData = await this.api.getSiteToday();

    // This has been commented out because the data did not correspond to the actual power generation :(
    // const measurePower = todayData?.latest_power?.value; // in W
    // if (typeof measurePower === 'number') {
    //   await this.setCapabilityValue('measure_power', measurePower)
    //     .catch(err => this.error('Error setting measure_power:', err));
    // }

    const meterPower = siteData?.module?.lifetime?.lifetimeEnergy?.value; // in Wh
    if (typeof meterPower === 'number') {
      await this.setCapabilityValue('meter_power', meterPower / 1000)
        .catch(err => this.error('Error setting meter_power:', err));
    }

    const meterPowerDay = todayData?.stats?.[0]?.totals?.production; // in Wh
    if (typeof meterPowerDay === 'number') {
      await this.setCapabilityValue('meter_power.day', meterPowerDay / 1000)
        .catch(err => this.error('Error setting meter_power.day:', err));
    }

  }

};