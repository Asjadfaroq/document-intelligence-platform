using System.Security.Cryptography;
using System.Text;
using DocumentIntelligence.Application;
using DocumentIntelligence.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;
using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;

namespace DocumentIntelligence.Infrastructure;

public class ApplicationDbContext : DbContext, IApplicationDbContext
{
    public ApplicationDbContext(DbContextOptions<ApplicationDbContext> options) : base(options)
    {
    }

    public DbSet<Tenant> Tenants => Set<Tenant>();
    public DbSet<User> Users => Set<User>();
    public DbSet<Workspace> Workspaces => Set<Workspace>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentChunk> DocumentChunks => Set<DocumentChunk>();
    public DbSet<Question> Questions => Set<Question>();
    public DbSet<Answer> Answers => Set<Answer>();

    IQueryable<Tenant> IApplicationDbContext.Tenants => Tenants.AsQueryable();
    IQueryable<User> IApplicationDbContext.Users => Users.AsQueryable();
    IQueryable<Workspace> IApplicationDbContext.Workspaces => Workspaces.AsQueryable();
    IQueryable<Document> IApplicationDbContext.Documents => Documents.AsQueryable();

    public async Task AddAsync<TEntity>(TEntity entity, CancellationToken cancellationToken) where TEntity : class
    {
        await Set<TEntity>().AddAsync(entity, cancellationToken);
    }

    public Task<int> SaveChangesAsync(CancellationToken cancellationToken)
    {
        return base.SaveChangesAsync(cancellationToken);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<Tenant>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).IsRequired().HasMaxLength(200);
            entity.Property(x => x.Slug).IsRequired().HasMaxLength(200);
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");
        });

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.HasIndex(x => new { x.Email, x.TenantId }).IsUnique();
            entity.Property(x => x.Email).IsRequired().HasMaxLength(256);
            entity.Property(x => x.PasswordHash).IsRequired();
            entity.Property(x => x.Role).IsRequired();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");

            entity.HasOne(x => x.Tenant)
                .WithMany(t => t.Users)
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Workspace>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Name).IsRequired().HasMaxLength(200);
            entity.Property(x => x.Description).HasMaxLength(1000);
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");

            entity.HasOne(x => x.Tenant)
                .WithMany(t => t.Workspaces)
                .HasForeignKey(x => x.TenantId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Document>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.FileName).IsRequired().HasMaxLength(500);
            entity.Property(x => x.StoragePath).IsRequired().HasMaxLength(1000);
            entity.Property(x => x.Language).HasMaxLength(10);
            entity.Property(x => x.Status).IsRequired();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");

            entity.HasOne(x => x.Workspace)
                .WithMany()
                .HasForeignKey(x => x.WorkspaceId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DocumentChunk>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.Content).IsRequired();
            entity.Property(x => x.MetadataJson);

            entity.HasOne(x => x.Document)
                .WithMany()
                .HasForeignKey(x => x.DocumentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Question>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.QuestionText).IsRequired();
            entity.Property(x => x.CreatedAt).HasDefaultValueSql("timezone('utc', now())");
        });

        modelBuilder.Entity<Answer>(entity =>
        {
            entity.HasKey(x => x.Id);
            entity.Property(x => x.AnswerText).IsRequired();
            entity.Property(x => x.SourcesJson);
            entity.Property(x => x.ModelName).HasMaxLength(200);

            entity.HasOne<Question>()
                .WithMany()
                .HasForeignKey(x => x.QuestionId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public class PasswordHasher : IPasswordHasher
{
    public string Hash(string password)
    {
        using var rng = RandomNumberGenerator.Create();
        var saltBytes = new byte[16];
        rng.GetBytes(saltBytes);
        var salt = Convert.ToBase64String(saltBytes);

        var hash = HashInternal(password, saltBytes);
        return $"{salt}.{Convert.ToBase64String(hash)}";
    }

    public bool Verify(string password, string hash)
    {
        var parts = hash.Split('.', 2);
        if (parts.Length != 2)
        {
            return false;
        }

        var saltBytes = Convert.FromBase64String(parts[0]);
        var storedHash = parts[1];

        var computedHash = HashInternal(password, saltBytes);
        var computedHashBase64 = Convert.ToBase64String(computedHash);

        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(storedHash),
            Encoding.UTF8.GetBytes(computedHashBase64));
    }

    private static byte[] HashInternal(string password, byte[] salt)
    {
        using var pbkdf2 = new Rfc2898DeriveBytes(password, salt, 100_000, HashAlgorithmName.SHA256);
        return pbkdf2.GetBytes(32);
    }
}

public class JwtTokenGenerator : IJwtTokenGenerator
{
    private readonly IConfiguration _configuration;

    public JwtTokenGenerator(IConfiguration configuration)
    {
        _configuration = configuration;
    }

    public string GenerateToken(User user)
    {
        var secret = _configuration["Jwt:Secret"];
        if (string.IsNullOrWhiteSpace(secret))
        {
            throw new InvalidOperationException("JWT secret is not configured.");
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.Email, user.Email),
            new("tenantId", user.TenantId.ToString()),
            new(ClaimTypes.Role, user.Role.ToString())
        };

        var token = new JwtSecurityToken(
            issuer: "document-intelligence",
            audience: "document-intelligence",
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
