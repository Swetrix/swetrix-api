import { Controller, Get, NotFoundException, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ViewsRepository } from './repositories/views.repository';
import { ViewEntity } from './entities/view.entity';
import { ProjectService } from '../../project/project.service';

@ApiTags("E-commerce/views")
@Controller('e-commerce/views')
export class ViewsController {
    constructor(
        private readonly viewsRepository: ViewsRepository,
        private readonly projectService: ProjectService
    ) {}

    @ApiOperation({ summary: 'Get project views' })
    @ApiOkResponse({ type: ViewEntity })
    @Get()
    async getViews(@Query('projectId') projectId: string) {
        const project = await this.projectService.findProject(projectId)
        
        if (!project) {
            throw new NotFoundException('View not found.')
        }

        return await this.viewsRepository.findViews(projectId)
    }
}
