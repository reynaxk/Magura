import { BadRequestException, Global, Injectable, Module } from '@nestjs/common';
import { env } from '../config';

/** Sightengine image checks for avatars, group icons and chat images. */
@Injectable()
export class ModerationService {
  async assertImageSafe(url: string): Promise<void> {
    if (!env.SIGHTENGINE_USER || !env.SIGHTENGINE_SECRET) return; // not configured → allow (dev)
    const params = new URLSearchParams({
      url,
      models: 'nudity-2.1,offensive-2.0,gore-2.0,scam',
      api_user: env.SIGHTENGINE_USER,
      api_secret: env.SIGHTENGINE_SECRET,
    });
    const res = await fetch(`https://api.sightengine.com/1.0/check.json?${params}`);
    const r = (await res.json()) as any;
    if (r.status !== 'success') return;
    const nudity = r.nudity ? Math.max(r.nudity.sexual_activity ?? 0, r.nudity.sexual_display ?? 0, r.nudity.erotica ?? 0) : 0;
    const offensive = r.offensive?.nazi ?? 0;
    const gore = r.gore?.prob ?? 0;
    const scam = r.scam?.prob ?? 0;
    if (nudity > 0.5 || offensive > 0.5 || gore > 0.5 || scam > 0.8) throw new BadRequestException('image_rejected');
  }
}

@Global()
@Module({ providers: [ModerationService], exports: [ModerationService] })
export class ModerationModule {}
