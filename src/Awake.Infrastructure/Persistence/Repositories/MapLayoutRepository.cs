using Awake.Application.Common.Interfaces.Repositories;
using Awake.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace Awake.Infrastructure.Persistence.Repositories;

public class MapLayoutRepository(AppDbContext context) : IMapLayoutRepository
{
    public async Task<IReadOnlyList<MapLayout>> GetByLocationAsync(
        string location, CancellationToken ct = default)
        => await context.MapLayouts
            .Include(x => x.Author)
            .Where(x => x.Location == location)
            .OrderByDescending(x => x.UpdatedAt)
            .ToListAsync(ct);

    public async Task<MapLayout?> GetByIdAsync(Guid id, CancellationToken ct = default)
        => await context.MapLayouts
            .Include(x => x.Author)
            .FirstOrDefaultAsync(x => x.Id == id, ct);

    public async Task<bool> ExistsByNameAsync(
        string location, string name, Guid? exceptId = null, CancellationToken ct = default)
        => await context.MapLayouts
            .AnyAsync(x => x.Location == location && x.Name == name && (exceptId == null || x.Id != exceptId), ct);

    public async Task AddAsync(MapLayout layout, CancellationToken ct = default)
    {
        await context.MapLayouts.AddAsync(layout, ct);
        await context.SaveChangesAsync(ct);
    }

    public async Task UpdateAsync(MapLayout layout, CancellationToken ct = default)
    {
        context.MapLayouts.Update(layout);
        await context.SaveChangesAsync(ct);
    }

    public async Task RemoveAsync(MapLayout layout, CancellationToken ct = default)
    {
        context.MapLayouts.Remove(layout);
        await context.SaveChangesAsync(ct);
    }
}
