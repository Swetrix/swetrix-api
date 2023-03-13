import { ApiProperty } from '@nestjs/swagger'
import { IsNotEmpty } from 'class-validator'

export class ManualDTO {
  @ApiProperty({
    example: 'aUn1quEid-3',
    required: true,
    description: 'A unique project ID',
  })
  @IsNotEmpty()
  pid: string

  @ApiProperty({
    required: true,
  })
  @IsNotEmpty()
  hash: string

  @ApiProperty({
    required: true,
    example: '4vic2',
    description: 'Captcha code',
  })
  @IsNotEmpty()
  code: string
}