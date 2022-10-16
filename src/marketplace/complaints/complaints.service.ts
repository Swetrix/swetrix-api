import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { FindManyOptions, Repository } from 'typeorm'
import { Complaint } from './entities/complaint.entity'

@Injectable()
export class ComplaintsService {
  constructor(
    @InjectRepository(Complaint)
    private complaintsRepository: Repository<Complaint>,
  ) {}

  async findAndCount(
    options: FindManyOptions<Complaint>,
  ): Promise<[Complaint[], number]> {
    return await this.complaintsRepository.findAndCount({ ...options })
  }
}