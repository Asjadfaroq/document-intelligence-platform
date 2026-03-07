using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace DocumentIntelligence.Infrastructure;

/// <summary>
/// Used by EF Core design-time tools (e.g. dotnet ef database update) when the host cannot
/// provide configuration. Loads .env from the solution or API directory so the connection string is available.
/// </summary>
public sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<ApplicationDbContext>
{
    public ApplicationDbContext CreateDbContext(string[] args)
    {
        LoadEnvIfPresent();
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__Default")
            ?? Environment.GetEnvironmentVariable("ConnectionStrings:Default");
        if (string.IsNullOrWhiteSpace(connectionString))
            throw new InvalidOperationException(
                "Set ConnectionStrings__Default (e.g. in .env) or run from a shell that has sourced .env before 'dotnet ef database update'.");

        var optionsBuilder = new DbContextOptionsBuilder<ApplicationDbContext>();
        optionsBuilder.UseNpgsql(connectionString, npgsql => npgsql.UseVector());
        return new ApplicationDbContext(optionsBuilder.Options);
    }

    private static void LoadEnvIfPresent()
    {
        var dir = Directory.GetCurrentDirectory();
        for (var i = 0; i < 5; i++)
        {
            var path = Path.Combine(dir, ".env");
            if (File.Exists(path))
            {
                LoadEnvFile(path);
                return;
            }
            var parent = Path.GetDirectoryName(dir);
            if (string.IsNullOrEmpty(parent) || parent == dir) break;
            dir = parent;
        }
    }

    private static void LoadEnvFile(string path)
    {
        foreach (var line in File.ReadAllLines(path))
        {
            var s = line.Trim();
            if (string.IsNullOrEmpty(s) || s[0] == '#') continue;
            var eq = s.IndexOf('=');
            if (eq <= 0) continue;
            var key = s[0..eq].Trim();
            var value = s[(eq + 1)..].Trim();
            if (value.Length >= 2 && ((value[0] == '"' && value[^1] == '"') || (value[0] == '\'' && value[^1] == '\'')))
                value = value[1..^1];
            if (!string.IsNullOrEmpty(key))
                Environment.SetEnvironmentVariable(key, value);
        }
    }
}
