using Microsoft.EntityFrameworkCore.Migrations;
using Pgvector;

#nullable disable

namespace DocumentIntelligence.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class SyncVectorModelSnapshot : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<Vector>(
                name: "Embedding",
                table: "DocumentChunks",
                type: "vector(384)",
                nullable: true,
                oldClrType: typeof(float[]),
                oldType: "real[]",
                oldNullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<float[]>(
                name: "Embedding",
                table: "DocumentChunks",
                type: "real[]",
                nullable: true,
                oldClrType: typeof(Vector),
                oldType: "vector(384)",
                oldNullable: true);
        }
    }
}
