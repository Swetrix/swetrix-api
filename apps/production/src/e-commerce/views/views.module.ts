import { Module } from '@nestjs/common';
import { ViewEntity } from './entities/view.entity';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([ViewEntity])]
})
export class ViewsModule {}