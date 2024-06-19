import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ViewEntity } from "../entities/view.entity";
import { Repository } from "typeorm";

@Injectable()
export class ViewsRepository {
    constructor(
        @InjectRepository(ViewEntity)
        private viewsRepository: Repository<ViewEntity>,
    ) {

    }
    async findViews(projectId:string){
        return await this.viewsRepository.find({
            projectId
        })
    }

}