using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace DocumentIntelligence.Infrastructure.Migrations
{
    /// <inheritdoc />
    public partial class AddPgVectorSupport : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("CREATE EXTENSION IF NOT EXISTS vector;");
            migrationBuilder.Sql(@"ALTER TABLE ""DocumentChunks"" DROP COLUMN IF EXISTS ""Embedding"";");
            migrationBuilder.Sql(@"ALTER TABLE ""DocumentChunks"" ADD COLUMN ""Embedding"" vector(384) NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("ALTER TABLE \"DocumentChunks\" DROP COLUMN \"Embedding\";");
            migrationBuilder.Sql("ALTER TABLE \"DocumentChunks\" ADD COLUMN \"Embedding\" real[] NULL;");
        }
    }
}
