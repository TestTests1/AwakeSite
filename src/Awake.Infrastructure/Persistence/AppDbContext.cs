using Awake.Domain.Common;
using Awake.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Awake.Infrastructure.Persistence;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Squad> Squads => Set<Squad>();
    public DbSet<SquadMember> SquadMembers => Set<SquadMember>();
    public DbSet<Ticket> Tickets => Set<Ticket>();
    public DbSet<TicketComment> TicketComments => Set<TicketComment>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<DiscordGuildSettings> DiscordGuildSettings => Set<DiscordGuildSettings>();
    public DbSet<PlayerStatsSnapshot> PlayerStatsSnapshots => Set<PlayerStatsSnapshot>();
    public DbSet<PlayerInventoryItem> PlayerInventoryItems => Set<PlayerInventoryItem>();
    public DbSet<PlayerBuildProof> PlayerBuildProofs => Set<PlayerBuildProof>();
    public DbSet<PlayerBoostRequest> PlayerBoostRequests => Set<PlayerBoostRequest>();
    public DbSet<MapLayout> MapLayouts => Set<MapLayout>();

    protected override void OnModelCreating(ModelBuilder builder)
    {
        builder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        builder.Entity<PlayerInventoryItem>(e =>
        {
            e.Property(x => x.ItemId).HasMaxLength(64);
            e.HasIndex(x => new { x.UserId, x.ItemId }).IsUnique();
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PlayerBuildProof>(e =>
        {
            e.Property(x => x.ContentType).HasMaxLength(64);
            e.HasIndex(x => new { x.UserId, x.BuildType }).IsUnique();
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        builder.Entity<PlayerBoostRequest>(e =>
        {
            e.Property(x => x.ItemId).HasMaxLength(64);
            e.HasIndex(x => new { x.UserId, x.BoostType }).IsUnique();
            e.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }

    public override Task<int> SaveChangesAsync(CancellationToken ct = default)
    {
        foreach (var entry in ChangeTracker.Entries<BaseEntity>()
            .Where(e => e.State == EntityState.Modified))
            entry.Entity.UpdatedAt = DateTime.UtcNow;

        return base.SaveChangesAsync(ct);
    }
}
