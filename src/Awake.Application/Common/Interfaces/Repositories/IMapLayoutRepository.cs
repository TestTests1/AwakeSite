using Awake.Domain.Entities;

namespace Awake.Application.Common.Interfaces.Repositories;

public interface IMapLayoutRepository
{
    Task<IReadOnlyList<MapLayout>> GetByLocationAsync(string location, CancellationToken ct = default);
    Task<MapLayout?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<bool> ExistsByNameAsync(string location, string name, Guid? exceptId = null, CancellationToken ct = default);
    Task AddAsync(MapLayout layout, CancellationToken ct = default);
    Task UpdateAsync(MapLayout layout, CancellationToken ct = default);
    Task RemoveAsync(MapLayout layout, CancellationToken ct = default);
}
