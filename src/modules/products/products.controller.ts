import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Express } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import {
  imageDiskStorage,
  imageFileFilter,
  MAX_IMAGE_SIZE_BYTES,
} from '../../common/utils/upload.util';
import { CreateProductDto } from './dto/create-product.dto';
import { ListProductsQueryDto } from './dto/list-products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiCookieAuth('access_token')
@Controller('products')
@UseGuards(CsrfGuard, JwtAuthGuard, PermissionsGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @RequirePermissions('products:read')
  @Get()
  findAll(@Query() query: ListProductsQueryDto) {
    return this.productsService.findAll(query);
  }

  @RequirePermissions('products:read')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.findOne(id);
  }

  @RequirePermissions('products:create')
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @RequirePermissions('products:update')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  // Local disk storage for now, not a cloud bucket — see
  // common/utils/upload.util.ts for the disclosed limitations. Gated behind
  // products:update since replacing a product's image is an edit action.
  @ApiOperation({ summary: 'Upload a product image (JPEG/PNG/WebP, max 5MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @RequirePermissions('products:update')
  @Post(':id/image')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: imageDiskStorage('products'),
      fileFilter: imageFileFilter,
      limits: { fileSize: MAX_IMAGE_SIZE_BYTES },
    }),
  )
  async uploadImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }
    return this.productsService.setImage(id, `/uploads/products/${file.filename}`);
  }

  @RequirePermissions('products:delete')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.productsService.remove(id);
  }
}
