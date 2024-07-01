import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { ProjectViewEntity } from '../entity/project-view.entity'
import { CreateProjectViewDto } from '../dto/create-project-view.dto'
import { UpdateProjectViewDto } from '../dto/update-project-view.dto'
import { ProjectViewCustomEventEntity } from '../entity/project-view-custom-event.entity'

@Injectable()
export class ProjectsViewsRepository {
  constructor(
    @InjectRepository(ProjectViewEntity)
    private viewsRepository: Repository<ProjectViewEntity>,
    @InjectRepository(ProjectViewCustomEventEntity)
    private projectViewCustomEventsRepository: Repository<ProjectViewCustomEventEntity>,
  ) {}

  async findViews(projectId: string) {
    return this.viewsRepository.find({
      where: { projectId },
      relations: ['customEvents'],
    })
  }

  async createProjectView(projectId: string, data: CreateProjectViewDto) {
    const view = await this.viewsRepository.save({
      project: { id: projectId },
      ...data,
      customEvents: data.customEvents,
    })

    const customEventPromises = data.customEvents.map(customEvent =>
      this.projectViewCustomEventsRepository.save({
        viewId: view.id,
        ...customEvent,
      }),
    )
    await Promise.all(customEventPromises)

    return view
  }

  async findView(id: string) {
    return this.viewsRepository.findOne({
      where: { id },
      relations: ['customEvents'],
    })
  }

  async findProjectView(projectId: string, viewId: string) {
    return this.viewsRepository.findOne({
      where: { id: viewId, projectId },
      relations: ['customEvents'],
    })
  }

  async updateProjectView(id: string, data: UpdateProjectViewDto) {
    await this.viewsRepository.update({ id }, data)
  }

  async deleteProjectView(id: string) {
    await this.viewsRepository.delete({ id })
  }
}
