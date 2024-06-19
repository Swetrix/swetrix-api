import { Module } from '@nestjs/common';
import { ViewsController } from './views.controller';
import { ViewEntity } from './entities/view.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ViewsRepository } from './repositories/views.repository';
import { ProjectModule } from '../../project/project.module';


@Module({
  imports: [TypeOrmModule.forFeature([ViewEntity]), ProjectModule],
  controllers: [ViewsController],
  providers: [ViewsRepository] 

})
export class ViewsModule {

  
}