import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ProjectViewEntity } from '../entity/project-view.entity'
import { CreateProjectViewDto } from '../dto/create-project-view.dto'
import { UpdateProjectViewDto } from '../dto/update-project-view.dto'

@Injectable()
export class ProjectsViewsRepository {
  constructor(
    @InjectRepository(ProjectViewEntity)
    private viewsRepository: Repository<ProjectViewEntity>,
  ) {}

  async findViews(projectId: string) {
    return this.viewsRepository.find({ projectId })
  }

  async createProjectView(projectId: string, data: CreateProjectViewDto) {
    return this.viewsRepository.save({
      project: { id: projectId },
      ...data,
    })
  }

  async findView(id: string) {
    return this.viewsRepository.findOne({ where: { id } })
  }

  async findProjectView(projectId: string, viewId: string) {
    return this.viewsRepository.findOne({ where: { id: viewId, projectId } })
  }

  async updateProjectView(id: string, data: UpdateProjectViewDto) {
    await this.viewsRepository.update({ id }, data)
  }

  async deleteProjectView(id: string) {
    await this.viewsRepository.delete({ id })
  }
}
