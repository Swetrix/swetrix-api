import { HttpModule } from '@nestjs/axios'
import { Module } from '@nestjs/common'
import { DiscordService } from './discord.service'

@Module({
  imports: [HttpModule],
  providers: [DiscordService],
  exports: [DiscordService],
})
export class DiscordModule {}
