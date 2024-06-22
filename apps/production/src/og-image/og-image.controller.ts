import { Controller, Query, Get, Header, Res } from '@nestjs/common'
import { ApiTags, ApiQuery, ApiResponse } from '@nestjs/swagger'
import { Response } from 'express'
import { createHash } from 'crypto'

import { OgImageService } from './og-image.service'
import { AppLoggerService } from '../logger/logger.service'
import { redis } from '../common/constants'

@ApiTags('Opengraph Image Generator')
@Controller(['v1/og-image'])
export class OgImageController {
  constructor(
    private readonly ogImageService: OgImageService,

    private readonly logger: AppLoggerService,
  ) {}

  @Get()
  @ApiQuery({ name: 'title', required: true })
  @Header('Content-Type', 'image/jpeg')
  // 2 weeks cache
  @Header(
    'Cache-Control',
    'immutable, no-transform, s-max-age=1210000, max-age=1210000',
  )
  @ApiResponse({ status: 200 })
  async getShared(
    @Query('title') title: string,
    @Res() res: Response,
  ): Promise<void> {
    this.logger.log({ title }, 'GET /og-image')

    const titleHash = createHash('sha256').update(title).digest('hex')

    let cachedImage = await redis.getBuffer(`og_images:${titleHash}`)

    if (!cachedImage) {
      const image = await this.ogImageService.getOgImage(title)
      await redis.set(
        `og_images:${titleHash}`,
        image,
        'PX',
        14 * 24 * 60 * 60 * 1000,
      )
      cachedImage = image
    }

    res.end(cachedImage)
  }
}
