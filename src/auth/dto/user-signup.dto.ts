import { ApiProperty } from '@nestjs/swagger'
import { IsEmail, IsNotEmpty } from 'class-validator'
// import { UserRole, Locale } from '../../users/entities/user.entity'

export class SignupUserDTO {
  @ApiProperty({ example: 'you@example.com', required: true })
  @IsEmail()
  email: string

  @ApiProperty({ example: 'your_password123', required: true })
  @IsNotEmpty()
  password: string

  // @IsEmpty()
  // role: UserRole

  @ApiProperty()
  checkIfLeaked: boolean
}
