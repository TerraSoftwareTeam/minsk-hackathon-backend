import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('healthcheck returns { ok: true }', () => {
    const controller = new HealthController();

    expect(controller.healthcheck()).toEqual({ ok: true });
  });
});
