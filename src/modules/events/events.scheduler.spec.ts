import { EventsScheduler } from './events.scheduler';
import { EventsService } from './events.service';

describe('EventsScheduler', () => {
  it('expires overdue events', async () => {
    const service = { expireOverdueVotes: jest.fn().mockResolvedValue(1) };
    await new EventsScheduler(service as unknown as EventsService).expireOverdueVotes();
    expect(service.expireOverdueVotes).toHaveBeenCalled();
  });

  it('does not throw when a run fails, the next tick retries', async () => {
    const service = { expireOverdueVotes: jest.fn().mockRejectedValue(new Error('db down')) };
    const scheduler = new EventsScheduler(service as unknown as EventsService);
    jest.spyOn(scheduler['logger'], 'error').mockImplementation(() => undefined);
    await expect(scheduler.expireOverdueVotes()).resolves.toBeUndefined();
  });
});
