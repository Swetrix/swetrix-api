import { IProject } from './IProject'

export interface IProjectForShared extends IProject {
    shared?: boolean
}

export interface ISharedProject {
    id: string
    confirmed: boolean
    role: string
    created: string
    updated: string
    project: IProjectForShared
    uiHidden: boolean
}
