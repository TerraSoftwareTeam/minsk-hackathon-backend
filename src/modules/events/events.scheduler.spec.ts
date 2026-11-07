import { EventsScheduler } from './events.scheduler';
import { EventsService } from './events.service';

describe('EventsScheduler', () => {
  it('closes due votings first, then expires overdue moderation', async () => {
    const calls: string[] = [];
    const service = {
      closeVoting: jest.fn(async () => (calls.push('closeVoting'), 1)),
      expireOverdue: jest.fn(async () => (calls.push('expireOverdue'), 1)),
    };
    await new EventsScheduler(service as unknown as EventsService).processDeadlines();
    expect(calls).toEqual(['closeVoting', 'expireOverdue']);
  });

  it('does not throw when a run fails, the next tick retries', async () => {
    const service = {
      closeVoting: jest.fn().mockRejectedValue(new Error('db down')),
      expireOverdue: jest.fn(),
    };
    const scheduler = new EventsScheduler(service as unknown as EventsService);
    jest.spyOn(scheduler['logger'], 'error').mockImplementation(() => undefined);
    await expect(scheduler.processDeadlines()).resolves.toBeUndefined();
  });
});
