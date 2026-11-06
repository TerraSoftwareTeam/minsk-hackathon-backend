import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryProvider } from './cloudinary.provider';

jest.mock('cloudinary', () => ({
  v2: {
    config: jest.fn(),
    uploader: {},
  },
}));

describe('CloudinaryProvider', () => {
  const configService = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        CLOUDINARY_NAME: 'test-cloud',
        CLOUDINARY_KEY: 'test-key',
        CLOUDINARY_SECRET: 'test-secret',
      };

      return values[key];
    }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('configures cloudinary from environment variables', () => {
    const result = CloudinaryProvider.useFactory(
      configService as unknown as ConfigService,
    );

    expect(configService.getOrThrow).toHaveBeenCalledWith('CLOUDINARY_NAME');
    expect(configService.getOrThrow).toHaveBeenCalledWith('CLOUDINARY_KEY');
    expect(configService.getOrThrow).toHaveBeenCalledWith('CLOUDINARY_SECRET');
    expect(cloudinary.config).toHaveBeenCalledWith({
      cloud_name: 'test-cloud',
      api_key: 'test-key',
      api_secret: 'test-secret',
    });
    expect(result).toBe(cloudinary);
  });
});
